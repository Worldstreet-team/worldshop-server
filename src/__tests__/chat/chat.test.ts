import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import * as chat from '../../services/chat.service';

const PREFIX = 'chattest-';
const SLUG = 'chattest';

let categoryId: string;

async function cleanup() {
  const stores = await prisma.store.findMany({
    where: { ownerId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const storeIds = stores.map((s) => s.id);

  if (storeIds.length) {
    const convos = await prisma.conversation.findMany({
      where: { storeId: { in: storeIds } },
      select: { id: true },
    });
    if (convos.length) {
      await prisma.message.deleteMany({ where: { conversationId: { in: convos.map((c) => c.id) } } });
      await prisma.conversation.deleteMany({ where: { id: { in: convos.map((c) => c.id) } } });
    }
    await prisma.product.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  }
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: PREFIX } } });
}

async function makeStore(name: string, status: 'DRAFT' | 'ACTIVE' = 'ACTIVE') {
  const ownerId = `${PREFIX}vendor-${name}`;
  await createTestUser({ userId: ownerId });
  return prisma.store.create({
    data: { ownerId, name: `${name} Store`, slug: `${SLUG}-${name}`, state: 'Lagos', status },
  });
}

async function makeListing(storeId: string, status: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED') {
  return prisma.product.create({
    data: {
      name: `${SLUG} listing ${Math.random().toString(36).slice(2, 8)}`,
      slug: `${SLUG}-l-${Math.random().toString(36).slice(2, 10)}`,
      description: 'A listing used for chat tests',
      basePrice: 5000,
      categoryId,
      storeId,
      status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
    },
  });
}

async function makeBuyer(name: string) {
  const id = `${PREFIX}buyer-${name}`;
  await createTestUser({ userId: id });
  return id;
}

describe('buyer–vendor chat', () => {
  beforeAll(async () => {
    await cleanup();
    const category = await prisma.category.upsert({
      where: { slug: `${SLUG}-cat` },
      create: { name: 'Chattest Category', slug: `${SLUG}-cat` },
      update: {},
    });
    categoryId = category.id;
  });

  afterEach(cleanup);

  afterAll(async () => {
    await prisma.category.deleteMany({ where: { slug: `${SLUG}-cat` } });
  });

  it('opens a thread and counts the inquiry once', async () => {
    const store = await makeStore('open');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('one');

    await chat.startConversation(buyer, { listingId: listing.id, message: 'Is this still available?' });

    const l = await prisma.product.findUnique({ where: { id: listing.id } });
    const s = await prisma.store.findUnique({ where: { id: store.id } });
    expect(l?.inquiryCount).toBe(1);
    expect(s?.inquiryCount).toBe(1);

    // A follow-up continues the thread — it is not a second inquiry.
    await chat.startConversation(buyer, { listingId: listing.id, message: 'Can you deliver?' });

    const threads = await prisma.conversation.findMany({ where: { storeId: store.id } });
    expect(threads).toHaveLength(1);

    const after = await prisma.product.findUnique({ where: { id: listing.id } });
    expect(after?.inquiryCount).toBe(1);
  });

  it('refuses to message an unpaid store', async () => {
    const store = await makeStore('unpaid', 'DRAFT');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('two');

    // Its listings are not browsable, so there was nothing to find.
    await expect(
      chat.startConversation(buyer, { listingId: listing.id, message: 'Hello there' }),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses to message an unpublished listing', async () => {
    const store = await makeStore('draftlisting');
    const listing = await makeListing(store.id, 'DRAFT');
    const buyer = await makeBuyer('three');

    await expect(
      chat.startConversation(buyer, { listingId: listing.id, message: 'Hello there' }),
    ).rejects.toThrow(/not found/i);
  });

  it('stops a vendor messaging their own store', async () => {
    const store = await makeStore('self');
    const listing = await makeListing(store.id);

    await expect(
      chat.startConversation(store.ownerId, { listingId: listing.id, message: 'Talking to myself' }),
    ).rejects.toThrow(/your own store/i);
  });

  it('hides threads from non-participants', async () => {
    const store = await makeStore('private');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('participant');
    const stranger = await makeBuyer('stranger');

    const convo = await chat.startConversation(buyer, { listingId: listing.id, message: 'Hi there' });

    // 404 rather than 403 — whether the thread exists is not their business.
    await expect(chat.getConversation(stranger, convo!.id)).rejects.toThrow(/not found/i);
    await expect(chat.sendMessage(stranger, convo!.id, 'Butting in')).rejects.toThrow(/not found/i);
  });

  it('tracks unread counts per side', async () => {
    const store = await makeStore('unread');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('unread');

    const convo = await chat.startConversation(buyer, { listingId: listing.id, message: 'First question' });

    let thread = await prisma.conversation.findUnique({ where: { id: convo!.id } });
    expect(thread).toMatchObject({ vendorUnread: 1, buyerUnread: 0 });

    await chat.markRead(store.ownerId, convo!.id);
    await chat.sendMessage(store.ownerId, convo!.id, 'Yes it is available');

    thread = await prisma.conversation.findUnique({ where: { id: convo!.id } });
    expect(thread).toMatchObject({ vendorUnread: 0, buyerUnread: 1 });

    await chat.markRead(buyer, convo!.id);
    thread = await prisma.conversation.findUnique({ where: { id: convo!.id } });
    expect(thread?.buyerUnread).toBe(0);
  });

  it('only stamps the counterpart’s messages as read', async () => {
    const store = await makeStore('readstamp');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('readstamp');

    const convo = await chat.startConversation(buyer, { listingId: listing.id, message: 'Question here' });
    await chat.markRead(store.ownerId, convo!.id);

    const messages = await prisma.message.findMany({ where: { conversationId: convo!.id } });
    expect(messages[0].readAt).not.toBeNull();

    // The vendor reading their own reply would make "seen" meaningless.
    await chat.sendMessage(store.ownerId, convo!.id, 'My reply');
    await chat.markRead(store.ownerId, convo!.id);

    const vendorMsg = await prisma.message.findFirst({
      where: { conversationId: convo!.id, senderRole: 'VENDOR' },
    });
    expect(vendorMsg?.readAt).toBeNull();
  });

  it('records the first vendor reply and derives store response metrics', async () => {
    const store = await makeStore('metrics');
    const listingA = await makeListing(store.id);
    const listingB = await makeListing(store.id);
    const buyer = await makeBuyer('metrics');

    const answered = await chat.startConversation(buyer, { listingId: listingA.id, message: 'Question A' });
    await chat.startConversation(buyer, { listingId: listingB.id, message: 'Question B' });

    await chat.sendMessage(store.ownerId, answered!.id, 'Answer to A');

    const thread = await prisma.conversation.findUnique({ where: { id: answered!.id } });
    expect(thread?.vendorFirstReplyAt).not.toBeNull();

    // One of two threads answered — unanswered threads count against the rate.
    const s = await prisma.store.findUnique({ where: { id: store.id } });
    expect(s?.responseRate).toBe(0.5);
    expect(s?.avgResponseMins).toBe(0);

    // A second reply in the same thread must not move the first-reply time.
    const before = thread!.vendorFirstReplyAt!.getTime();
    await chat.sendMessage(store.ownerId, answered!.id, 'Following up');
    const after = await prisma.conversation.findUnique({ where: { id: answered!.id } });
    expect(after!.vendorFirstReplyAt!.getTime()).toBe(before);
  });

  it('exposes the review anchor: a replied-to thread', async () => {
    const store = await makeStore('anchor');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('anchor');

    const convo = await chat.startConversation(buyer, { listingId: listing.id, message: 'Anchor question' });

    // A message the vendor ignored is not evidence of contact.
    expect(await chat.hasRepliedConversation(store.id, buyer)).toBe(false);

    await chat.sendMessage(store.ownerId, convo!.id, 'Anchor reply');
    expect(await chat.hasRepliedConversation(store.id, buyer)).toBe(true);
  });

  it('separates the buying and selling inboxes', async () => {
    const store = await makeStore('bothsides');
    const otherStore = await makeStore('counterparty');
    const otherListing = await makeListing(otherStore.id);
    const myListing = await makeListing(store.id);

    // The vendor of `store` is also a buyer at `otherStore`.
    const alsoBuyer = store.ownerId;
    await chat.startConversation(alsoBuyer, { listingId: otherListing.id, message: 'Buying something' });

    const someoneElse = await makeBuyer('customer');
    await chat.startConversation(someoneElse, { listingId: myListing.id, message: 'Selling something' });

    const buying = await chat.listConversations(alsoBuyer, { side: 'buying', page: 1, limit: 20 });
    const selling = await chat.listConversations(alsoBuyer, { side: 'selling', page: 1, limit: 20 });

    expect(buying.total).toBe(1);
    expect(selling.total).toBe(1);
    expect(buying.conversations[0].storeId).toBe(otherStore.id);
    expect(selling.conversations[0].storeId).toBe(store.id);

    const summary = await chat.getUnreadSummary(alsoBuyer);
    expect(summary.selling).toBe(1); // the customer's message
    expect(summary.buying).toBe(0); // their own outgoing message
  });

  it('re-opens an archived thread when someone replies into it', async () => {
    const store = await makeStore('archive');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('archive');

    const convo = await chat.startConversation(buyer, { listingId: listing.id, message: 'Archived question' });
    await chat.archiveConversation(buyer, convo!.id);

    expect((await prisma.conversation.findUnique({ where: { id: convo!.id } }))?.status).toBe('ARCHIVED');

    await chat.sendMessage(store.ownerId, convo!.id, 'Late reply');
    expect((await prisma.conversation.findUnique({ where: { id: convo!.id } }))?.status).toBe('OPEN');
  });

  it('blocks messaging on a blocked thread', async () => {
    const store = await makeStore('blocked');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('blocked');

    const convo = await chat.startConversation(buyer, { listingId: listing.id, message: 'Before block' });
    await prisma.conversation.update({ where: { id: convo!.id }, data: { status: 'BLOCKED' } });

    await expect(chat.sendMessage(buyer, convo!.id, 'After block')).rejects.toThrow(/closed/i);
    await expect(
      chat.startConversation(buyer, { listingId: listing.id, message: 'Sneaking back' }),
    ).rejects.toThrow(/closed/i);
  });

  it('flags contact details without changing the message', async () => {
    const store = await makeStore('contact');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('contact');

    const convo = await chat.startConversation(buyer, {
      listingId: listing.id,
      message: 'Call me on 08031234567 to arrange',
    });

    const message = await prisma.message.findFirst({ where: { conversationId: convo!.id } });
    expect(message?.hasContactInfo).toBe(true);
    // Default policy is measure-not-intervene.
    expect(message?.body).toContain('08031234567');
  });

  it('detects contact details across common evasions', () => {
    expect(chat.detectContactInfo('call 08031234567')).toBe(true);
    expect(chat.detectContactInfo('+234 803 123 4567 please')).toBe(true);
    expect(chat.detectContactInfo('0803-123-4567')).toBe(true);
    expect(chat.detectContactInfo('mail me at seller @ gmail.com')).toBe(true);
    expect(chat.detectContactInfo('find me on whatsapp: jaystore')).toBe(true);
    expect(chat.detectContactInfo('Is the red one still available?')).toBe(false);
    expect(chat.detectContactInfo('I can pay 250000 for it')).toBe(false);
  });

  it('keeps thread history when a listing is deleted', async () => {
    const store = await makeStore('deleted');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('deleted');

    const convo = await chat.startConversation(buyer, { listingId: listing.id, message: 'About this item' });
    await chat.sendMessage(store.ownerId, convo!.id, 'Sold, sorry');
    await prisma.product.delete({ where: { id: listing.id } });

    // The vendor's response record must survive the listing going away.
    const thread = await prisma.conversation.findUnique({
      where: { id: convo!.id },
      include: { messages: true },
    });
    expect(thread).not.toBeNull();
    expect(thread?.listingId).toBeNull();
    expect(thread?.messages).toHaveLength(2);
    expect(thread?.vendorFirstReplyAt).not.toBeNull();
  });
});
