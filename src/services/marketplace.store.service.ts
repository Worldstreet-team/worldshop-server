/**
 * Store management for the marketplace model.
 *
 * A store is created by any authenticated user, starts in DRAFT, and only
 * becomes publicly visible once its subscription is paid
 * (see subscription.service.ts). The owner can always see and edit their own
 * store while it is DRAFT or EXPIRED — the paywall gates *visibility to
 * buyers*, not the vendor's ability to prepare their listings.
 *
 * This replaces the vendor fields on UserProfile. The legacy path in
 * store.service.ts still reads those fields and stays in place until the
 * backfill has run everywhere.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { slugify } from '../utils/slugify';
import { signStoreBranding } from '../utils/signUrl';
import { createSubscription, isVisibleStatus } from './subscription.service';
import type { CreateStoreInput, UpdateStoreInput } from '../validators/store.validator';
import { Prisma, type Store } from '../../generated/prisma';

/** Statuses a buyer is allowed to see — ACTIVE plus the grace window. */
const VISIBLE_STATUSES: Prisma.EnumStoreStatusFilter = { in: ['ACTIVE', 'GRACE'] };

const DEFAULT_RESERVED_SLUGS = [
  'admin', 'vendor', 'vendors', 'account', 'auth', 'store', 'stores', 'api',
  'checkout', 'cart', 'search', 'category', 'categories', 'me', 'plans', 'new',
];

function getReservedSlugs(): string[] {
  const env = process.env.RESERVED_STORE_SLUGS;
  if (env) return env.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_RESERVED_SLUGS;
}

/**
 * Turns a store name into a free slug, appending -2, -3, … on collision.
 * The unique index is still the real guard; this just avoids handing the user
 * a 409 for something we can resolve ourselves.
 */
async function buildUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  if (!base) {
    throw createError(400, 'Store name must contain at least one letter or number');
  }
  if (getReservedSlugs().includes(base)) {
    throw createError(400, `"${name}" is a reserved name — please choose another`);
  }

  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const taken = await prisma.store.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw createError(409, 'Too many stores share that name — please choose another');
}

/**
 * Creates the store and its (unpaid) subscription together. One store per
 * user: `ownerId` is unique, so a second attempt is rejected rather than
 * silently creating an orphan.
 */
export async function createStore(ownerId: string, input: CreateStoreInput) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId: ownerId },
    select: { id: true, email: true },
  });
  if (!profile) throw createError(404, 'Complete your profile before creating a store');

  const existing = await prisma.store.findUnique({ where: { ownerId }, select: { id: true } });
  if (existing) throw createError(409, 'You already have a store');

  const slug = await buildUniqueSlug(input.name);

  const store = await prisma.store.create({
    data: {
      ownerId,
      name: input.name,
      slug,
      description: input.description,
      phone: input.phone,
      whatsapp: input.whatsapp,
      email: input.email ?? profile.email,
      website: input.website,
      state: input.state,
      city: input.city,
      address: input.address,
      status: 'DRAFT',
    },
  });

  await createSubscription(store.id, input.planCode);

  return getMyStore(ownerId);
}

export async function getMyStore(ownerId: string) {
  const store = await prisma.store.findUnique({
    where: { ownerId },
    include: {
      subscription: { include: { plan: true } },
    },
  });
  if (!store) throw createError(404, 'You do not have a store yet');

  return {
    ...(await signStoreBranding(store)),
    isPubliclyVisible: isVisibleStatus(store.status),
  };
}

export async function updateStore(ownerId: string, input: UpdateStoreInput) {
  const store = await prisma.store.findUnique({ where: { ownerId } });
  if (!store) throw createError(404, 'You do not have a store yet');
  if (store.status === 'BANNED') throw createError(403, 'This store has been banned');

  // Renaming re-slugs only on explicit request: the old slug may already be
  // shared, printed or linked, and silently breaking it costs the vendor
  // traffic they paid for.
  const slug = input.regenerateSlug && input.name ? await buildUniqueSlug(input.name) : undefined;

  return prisma.store.update({
    where: { id: store.id },
    data: {
      name: input.name,
      description: input.description,
      logo: input.logo,
      banner: input.banner,
      phone: input.phone,
      whatsapp: input.whatsapp,
      email: input.email,
      website: input.website,
      state: input.state,
      city: input.city,
      address: input.address,
      openingHours: input.openingHours as Prisma.InputJsonValue | undefined,
      ...(slug ? { slug } : {}),
    },
  });
}

/**
 * Public store page. Returns null for anything a buyer should not see — an
 * unpaid, lapsed, suspended or banned store is indistinguishable from one that
 * does not exist.
 */
export async function getPublicStoreBySlug(slug: string): Promise<Store | null> {
  const store = await prisma.store.findUnique({ where: { slug } });
  if (!store || !isVisibleStatus(store.status)) return null;
  return signStoreBranding(store);
}

/** Browse: only stores currently paid up. */
export async function listPublicStores(opts: { page: number; limit: number; state?: string }) {
  const where: Prisma.StoreWhereInput = {
    status: VISIBLE_STATUSES,
    ...(opts.state ? { state: opts.state } : {}),
  };

  const [stores, total] = await Promise.all([
    prisma.store.findMany({
      where,
      orderBy: [{ listingCount: 'desc' }, { createdAt: 'desc' }],
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.store.count({ where }),
  ]);

  return { stores: await Promise.all(stores.map(signStoreBranding)), total };
}
