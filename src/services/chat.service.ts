/**
 * Buyer–vendor chat.
 *
 * This is the platform's core interaction now that nothing is transacted
 * on-site, and three other features are built on top of it:
 *
 *   - inquiry counts   → the renewal argument ("40 messages this month")
 *   - response rate    → the trust signal shown to buyers
 *   - a replied thread → what verifies a review
 *
 * Direction is deliberately one-way at the start: buyers open threads from a
 * listing, vendors reply. A vendor who could open threads at will would have a
 * broadcast channel to every registered user, which is a spam vector with no
 * legitimate use — they have nothing to ask a buyer who has not asked first.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { globalLog as logger } from '../configs/loggerConfig';
import { isVisibleStatus } from './subscription.service';
import { signProductImages, signR2Key } from '../utils/signUrl';
import { Prisma, type SenderRole } from '../../generated/prisma';

const VISIBLE_STORE_STATUSES: Prisma.EnumStoreStatusFilter = { in: ['ACTIVE', 'GRACE'] };

/**
 * What to do when a message contains contact details.
 *
 *   flag   — record it and deliver as-is (default)
 *   redact — replace the details with a notice
 *   block  — reject the message
 *
 * Default is `flag` because it changes nothing for users while making the
 * behaviour measurable. Vendors moving buyers straight to WhatsApp costs the
 * platform its response-rate signal, its review anchor and its evidence of
 * what the $5 bought — but that is a policy call, and it should be made on
 * data rather than guessed at.
 */
const CONTACT_POLICY = (process.env.CHAT_CONTACT_POLICY || 'flag') as 'flag' | 'redact' | 'block';

// Nigerian mobile numbers appear as 08012345678, +2348012345678, 234 801 …,
// and are often spaced or dotted to evade naive matching.
const PHONE_RE = /(?:\+?234|0)[\s.-]?[789][01]\d(?:[\s.-]?\d){7}/;
const EMAIL_RE = /[\w.+-]+\s?@\s?[\w-]+\s?\.\s?[a-z]{2,}/i;
const HANDLE_RE = /\b(?:wa\.me|whatsapp|telegram|t\.me|instagram|ig)\b[\s:@]*[\w.+/-]{3,}/i;

export function detectContactInfo(body: string): boolean {
  return PHONE_RE.test(body) || EMAIL_RE.test(body) || HANDLE_RE.test(body);
}

function applyContactPolicy(body: string): { body: string; hasContactInfo: boolean } {
  const hasContactInfo = detectContactInfo(body);
  if (!hasContactInfo) return { body, hasContactInfo: false };

  if (CONTACT_POLICY === 'block') {
    throw createError(
      400,
      'Please keep contact details in your store profile rather than in messages.',
    );
  }
  if (CONTACT_POLICY === 'redact') {
    return {
      body: body
        .replace(PHONE_RE, '[contact hidden]')
        .replace(EMAIL_RE, '[contact hidden]')
        .replace(HANDLE_RE, '[contact hidden]'),
      hasContactInfo: true,
    };
  }
  return { body, hasContactInfo: true };
}

export type Participant = { role: SenderRole; storeId: string; buyerId: string };

/**
 * Resolves the caller's side of a thread. Returns 404 rather than 403 for
 * non-participants: whether a given conversation exists is not their business.
 */
async function participantOf(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { store: { select: { id: true, ownerId: true, name: true, slug: true } } },
  });
  if (!conversation) throw createError(404, 'Conversation not found');

  const role: SenderRole | null =
    conversation.buyerId === userId ? 'BUYER' : conversation.store.ownerId === userId ? 'VENDOR' : null;

  if (!role) throw createError(404, 'Conversation not found');

  return { conversation, role };
}

/**
 * Opens (or continues) a thread about a listing.
 *
 * Only publicly visible listings can be messaged: if a store has not paid, its
 * listings are not browsable, so there is nothing for a buyer to have found.
 * A repeat question continues the existing thread rather than starting a second
 * one, which keeps the vendor's inbox one-row-per-buyer-per-listing.
 */
export async function startConversation(
  buyerId: string,
  input: { listingId: string; message: string },
) {
  const listing = await prisma.product.findFirst({
    where: {
      id: input.listingId,
      status: 'PUBLISHED',
      store: { is: { status: VISIBLE_STORE_STATUSES } },
    },
    select: { id: true, name: true, storeId: true, store: { select: { ownerId: true } } },
  });
  if (!listing || !listing.storeId) throw createError(404, 'Listing not found');

  if (listing.store?.ownerId === buyerId) {
    throw createError(400, 'You cannot message your own store');
  }

  const existing = await prisma.conversation.findFirst({
    where: { listingId: listing.id, buyerId },
  });

  if (existing) {
    if (existing.status === 'BLOCKED') throw createError(403, 'This conversation is closed');
    await sendMessage(buyerId, existing.id, input.message);
    return prisma.conversation.findUnique({
      where: { id: existing.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  const { body, hasContactInfo } = applyContactPolicy(input.message);

  const conversation = await prisma.conversation.create({
    data: {
      listingId: listing.id,
      storeId: listing.storeId,
      buyerId,
      vendorUnread: 1,
      lastMessageAt: new Date(),
      messages: {
        create: { senderId: buyerId, senderRole: 'BUYER', body, hasContactInfo },
      },
    },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });

  // Counted once per thread, not per message — this is the number a vendor
  // judges the subscription by, and inflating it with chatter makes it a lie.
  await prisma.$transaction([
    prisma.product.update({ where: { id: listing.id }, data: { inquiryCount: { increment: 1 } } }),
    prisma.store.update({ where: { id: listing.storeId }, data: { inquiryCount: { increment: 1 } } }),
  ]);

  logger.info('[Chat] Conversation opened', {
    conversationId: conversation.id,
    storeId: listing.storeId,
    listingId: listing.id,
  });

  return conversation;
}

export async function sendMessage(userId: string, conversationId: string, rawBody: string) {
  const { conversation, role } = await participantOf(conversationId, userId);

  if (conversation.status === 'BLOCKED') throw createError(403, 'This conversation is closed');

  const { body, hasContactInfo } = applyContactPolicy(rawBody);
  const now = new Date();
  const isFirstVendorReply = role === 'VENDOR' && !conversation.vendorFirstReplyAt;

  const message = await prisma.message.create({
    data: { conversationId, senderId: userId, senderRole: role, body, hasContactInfo },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: now,
      // Re-opening by replying to an archived thread is the natural reading of
      // sending a message into it.
      ...(conversation.status === 'ARCHIVED' ? { status: 'OPEN' as const } : {}),
      ...(isFirstVendorReply ? { vendorFirstReplyAt: now } : {}),
      ...(role === 'BUYER'
        ? { vendorUnread: { increment: 1 } }
        : { buyerUnread: { increment: 1 } }),
    },
  });

  if (isFirstVendorReply) {
    await recomputeStoreResponseMetrics(conversation.storeId);
  }

  return message;
}

/**
 * Marks the other side's messages read and clears the caller's unread badge.
 * Only the counterpart's messages get `readAt` — stamping your own would make
 * "read by the vendor" meaningless.
 */
export async function markRead(userId: string, conversationId: string) {
  const { role } = await participantOf(conversationId, userId);
  const counterpart: SenderRole = role === 'BUYER' ? 'VENDOR' : 'BUYER';

  const [updated] = await prisma.$transaction([
    prisma.message.updateMany({
      // An unread message has no `readAt` key at all, and MongoDB does not
      // treat a missing field as null — matching only `null` marks nothing.
      where: {
        conversationId,
        senderRole: counterpart,
        OR: [{ readAt: null }, { readAt: { isSet: false } }],
      },
      data: { readAt: new Date() },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: role === 'BUYER' ? { buyerUnread: 0 } : { vendorUnread: 0 },
    }),
  ]);

  return { markedRead: updated.count };
}

export async function archiveConversation(userId: string, conversationId: string) {
  await participantOf(conversationId, userId);
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'ARCHIVED' },
  });
}

const THREAD_INCLUDE = {
  listing: { select: { id: true, name: true, slug: true, images: true, basePrice: true, priceType: true } },
  store: { select: { id: true, name: true, slug: true, logo: true, verificationTier: true } },
} as const;

/**
 * Buyer display names for a page of threads, one query. Conversation.buyerId
 * is a bare Clerk user id — there is no Prisma relation to include — so the
 * profile is joined by hand here.
 *
 * First name + last initial, not the full name: the buyer has only sent a
 * message at this point, and the vendor gets the full identity the moment the
 * buyer chooses to move to phone/WhatsApp — that escalation is the buyer's
 * call, not a side effect of saying hello.
 */
async function buyerNamesByUserId(buyerIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(buyerIds)];
  if (unique.length === 0) return new Map();

  const profiles = await prisma.userProfile.findMany({
    where: { userId: { in: unique } },
    select: { userId: true, firstName: true, lastName: true },
  });

  return new Map(
    profiles.map((p) => {
      const initial = p.lastName?.trim() ? ` ${p.lastName.trim()[0].toUpperCase()}.` : '';
      return [p.userId, `${p.firstName}${initial}`.trim() || 'Buyer'];
    }),
  );
}

/**
 * Sign the R2-backed media on a thread (listing photos, store logo) before it
 * leaves the server. Stored values are keys or expired presigned URLs; only a
 * fresh signature renders.
 */
async function signThreadMedia<
  T extends {
    listing?: { images?: unknown } | null;
    store?: { logo?: string | null } | null;
  },
>(thread: T): Promise<T> {
  const out = { ...thread };
  if (out.listing?.images) {
    out.listing = { ...out.listing, images: await signProductImages(out.listing.images) };
  }
  if (out.store?.logo) {
    out.store = { ...out.store, logo: await signR2Key(out.store.logo) };
  }
  return out;
}

/**
 * The caller's threads. A user can be both a buyer and a vendor, so the side
 * is explicit rather than inferred — an inbox that silently mixes "messages I
 * sent about things I want" with "customers asking about my stock" is unusable.
 */
export async function listConversations(
  userId: string,
  opts: { side: 'buying' | 'selling'; page: number; limit: number; status?: 'OPEN' | 'ARCHIVED' },
) {
  let where: Prisma.ConversationWhereInput;

  if (opts.side === 'selling') {
    const store = await prisma.store.findUnique({ where: { ownerId: userId }, select: { id: true } });
    if (!store) throw createError(403, 'You do not have a store');
    where = { storeId: store.id };
  } else {
    where = { buyerId: userId };
  }

  if (opts.status) where.status = opts.status;

  const [conversations, total, unreadTotal] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: {
        ...THREAD_INCLUDE,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.conversation.count({ where }),
    prisma.conversation.aggregate({
      where,
      _sum: { vendorUnread: true, buyerUnread: true },
    }),
  ]);

  // Only the selling side needs the counterpart resolved — a buyer's threads
  // are already labelled by the store they wrote to.
  const buyerNames =
    opts.side === 'selling'
      ? await buyerNamesByUserId(conversations.map((c) => c.buyerId))
      : new Map<string, string>();

  return {
    conversations: await Promise.all(
      conversations.map(async (c) => ({
        ...(await signThreadMedia(c)),
        buyer:
          opts.side === 'selling'
            ? { id: c.buyerId, name: buyerNames.get(c.buyerId) ?? 'Buyer' }
            : null,
        lastMessage: c.messages[0] ?? null,
        unread: opts.side === 'selling' ? c.vendorUnread : c.buyerUnread,
        messages: undefined,
      })),
    ),
    total,
    unreadTotal:
      (opts.side === 'selling' ? unreadTotal._sum.vendorUnread : unreadTotal._sum.buyerUnread) ?? 0,
  };
}

export async function getConversation(
  userId: string,
  conversationId: string,
  opts: { page: number; limit: number } = { page: 1, limit: 50 },
) {
  const { role } = await participantOf(conversationId, userId);

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      ...THREAD_INCLUDE,
      messages: {
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      },
    },
  });

  // Resolved for vendors; harmless for the buyer (it is their own name, and
  // the UI ignores it on that side).
  const names = await buyerNamesByUserId([conversation!.buyerId]);

  return {
    ...(await signThreadMedia(conversation!)),
    buyer: { id: conversation!.buyerId, name: names.get(conversation!.buyerId) ?? 'Buyer' },
    // Oldest-first for display; newest-first was only for pagination.
    messages: [...conversation!.messages].reverse(),
    myRole: role,
  };
}

/**
 * Recomputes the store's response-rate and average reply time from its threads.
 *
 * Recomputed from scratch on each first reply rather than kept as a running
 * average: it is a small query, and an incrementally-maintained average drifts
 * silently once anything is deleted or backfilled. Threads the vendor has not
 * yet replied to count against the rate — that is the honest reading of "how
 * likely is this seller to answer me".
 */
export async function recomputeStoreResponseMetrics(storeId: string) {
  const threads = await prisma.conversation.findMany({
    where: { storeId },
    select: { createdAt: true, vendorFirstReplyAt: true },
  });

  if (!threads.length) {
    await prisma.store.update({
      where: { id: storeId },
      data: { responseRate: null, avgResponseMins: null },
    });
    return { responseRate: null, avgResponseMins: null };
  }

  const replied = threads.filter((t) => t.vendorFirstReplyAt);
  const responseRate = replied.length / threads.length;

  const avgResponseMins = replied.length
    ? Math.round(
        replied.reduce(
          (sum, t) => sum + (t.vendorFirstReplyAt!.getTime() - t.createdAt.getTime()) / 60_000,
          0,
        ) / replied.length,
      )
    : null;

  await prisma.store.update({
    where: { id: storeId },
    data: { responseRate, avgResponseMins },
  });

  return { responseRate, avgResponseMins };
}

/**
 * Whether this buyer has a thread with the store that the vendor actually
 * replied to. This is the review anchor: with no purchases to verify against,
 * a two-way conversation is the closest evidence that real contact happened.
 */
export async function hasRepliedConversation(storeId: string, buyerId: string): Promise<boolean> {
  const thread = await prisma.conversation.findFirst({
    where: { storeId, buyerId, vendorFirstReplyAt: { not: null } },
    select: { id: true },
  });
  return thread !== null;
}

/** Total unread across both sides — for a single header badge. */
export async function getUnreadSummary(userId: string) {
  const store = await prisma.store.findUnique({ where: { ownerId: userId }, select: { id: true } });

  const [buying, selling] = await Promise.all([
    prisma.conversation.aggregate({ where: { buyerId: userId }, _sum: { buyerUnread: true } }),
    store
      ? prisma.conversation.aggregate({ where: { storeId: store.id }, _sum: { vendorUnread: true } })
      : Promise.resolve({ _sum: { vendorUnread: 0 } }),
  ]);

  const buyingUnread = buying._sum.buyerUnread ?? 0;
  const sellingUnread = selling._sum.vendorUnread ?? 0;

  return { buying: buyingUnread, selling: sellingUnread, total: buyingUnread + sellingUnread };
}
