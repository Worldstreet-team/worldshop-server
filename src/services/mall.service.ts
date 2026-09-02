/**
 * Mall management.
 *
 * A mall is a paid umbrella over substores: any user can create one (kept in
 * DRAFT until the first subscription charge clears — see
 * mall.subscription.service.ts), then create substores inside it. Substores
 * are full Store rows (kind MALL_SUBSTORE) so listings, reviews and chat all
 * reuse the store machinery; their visibility is driven by the MALL's
 * subscription, cascaded onto Store.status by the billing transitions.
 *
 * One mall per user (Mall.ownerId is unique). Owning a mall is independent of
 * owning a personal store — the same user may run both.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { slugify } from '../utils/slugify';
import { signStoreBranding, signProductRecords } from '../utils/signUrl';
import {
  buildUniqueSlug as buildUniqueStoreSlug,
  PUBLIC_STORE_SELECT,
} from './marketplace.store.service';
import { getPlanByCode, isVisibleStatus } from './subscription.service';
import { createMallSubscription, DEFAULT_MALL_PLAN_CODE } from './mall.subscription.service';
import type {
  CreateMallInput,
  UpdateMallInput,
  CreateSubstoreInput,
  UpdateSubstoreInput,
} from '../validators/mall.validator';
import { Prisma } from '../../generated/prisma';

// A mall must be paid up to be seen. DRAFT (created, never charged) is not
// public — that is the paywall. The MALL_PAYWALL flag that briefly let DRAFT
// through for testing is gone; visibility is the subscription rule again, for
// malls exactly as for stores.
const VISIBLE_STATUSES: Prisma.EnumMallStatusFilter = { in: ['ACTIVE', 'GRACE'] };

const VISIBLE_STORE_STATUSES: Prisma.EnumStoreStatusFilter = { in: ['ACTIVE', 'GRACE'] };

export const MAX_FEATURED_LISTINGS = 12;

/**
 * What a buyer may see of a mall. A whitelist for the same reason as
 * PUBLIC_STORE_SELECT: ownerId and anything added later stays private until
 * deliberately listed here.
 */
const PUBLIC_MALL_SELECT = {
  id: true, name: true, slug: true, description: true, logo: true, banner: true,
  phone: true, whatsapp: true, website: true,
  state: true, city: true, address: true,
  status: true, substoreCount: true, featuredListingIds: true,
  createdAt: true,
} satisfies Prisma.MallSelect;

export type PublicMall = Prisma.MallGetPayload<{ select: typeof PUBLIC_MALL_SELECT }>;

/**
 * Same collision strategy as store slugs, against the Mall collection. Store
 * and mall slugs live in different namespaces (/stores/:slug vs /malls/:slug),
 * so they may overlap each other but not themselves.
 */
async function buildUniqueMallSlug(name: string): Promise<string> {
  const base = slugify(name);
  if (!base) {
    throw createError(400, 'Mall name must contain at least one letter or number');
  }

  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const taken = await prisma.mall.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw createError(409, 'Too many malls share that name — please choose another');
}

// ============================================
// Owner: the mall itself
// ============================================

export async function createMall(ownerId: string, input: CreateMallInput) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId: ownerId },
    select: { id: true, email: true },
  });
  if (!profile) throw createError(404, 'Complete your profile before creating a mall');

  const existing = await prisma.mall.findUnique({ where: { ownerId }, select: { id: true } });
  if (existing) throw createError(409, 'You already have a mall');

  // Validate the plan BEFORE creating anything: a bad planCode after the
  // create would strand a subscription-less mall that blocks every retry
  // with "You already have a mall" and has no delete path.
  await getPlanByCode(input.planCode ?? DEFAULT_MALL_PLAN_CODE, 'MALL');

  const slug = await buildUniqueMallSlug(input.name);

  const mall = await prisma.mall.create({
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

  await createMallSubscription(mall.id, input.planCode);

  return getMyMall(ownerId);
}

export async function getMyMall(ownerId: string) {
  const mall = await prisma.mall.findUnique({
    where: { ownerId },
    include: {
      subscription: { include: { plan: true } },
    },
  });
  if (!mall) throw createError(404, 'You do not have a mall yet');

  return {
    ...(await signStoreBranding(mall)),
    isPubliclyVisible: isVisibleStatus(mall.status),
  };
}

export async function updateMyMall(ownerId: string, input: UpdateMallInput) {
  const mall = await prisma.mall.findUnique({ where: { ownerId } });
  if (!mall) throw createError(404, 'You do not have a mall yet');
  if (mall.status === 'BANNED') throw createError(403, 'This mall has been banned');

  const slug = input.regenerateSlug && input.name ? await buildUniqueMallSlug(input.name) : undefined;

  return prisma.mall.update({
    where: { id: mall.id },
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
      ...(slug ? { slug } : {}),
    },
  });
}

// ============================================
// Owner: substores
// ============================================

/** Resolves the caller's mall or 404s. Shared by the substore operations. */
async function requireOwnedMall(ownerId: string) {
  const mall = await prisma.mall.findUnique({
    where: { ownerId },
    include: { subscription: { include: { plan: true } } },
  });
  if (!mall) throw createError(404, 'You do not have a mall yet');
  if (mall.status === 'BANNED') throw createError(403, 'This mall has been banned');
  if (mall.status === 'SUSPENDED') throw createError(403, 'This mall is suspended. Contact support.');
  return mall;
}

export async function createSubstore(ownerId: string, input: CreateSubstoreInput) {
  const mall = await requireOwnedMall(ownerId);

  const limit = mall.subscription?.plan?.substoreLimit ?? null;
  if (limit !== null && mall.substoreCount >= limit) {
    throw createError(409, `Your plan allows up to ${limit} stores`);
  }

  const slug = await buildUniqueStoreSlug(input.name);

  const [substore] = await prisma.$transaction([
    prisma.store.create({
      data: {
        ownerId,
        kind: 'MALL_SUBSTORE',
        mallId: mall.id,
        name: input.name,
        slug,
        description: input.description,
        phone: input.phone,
        whatsapp: input.whatsapp,
        email: input.email,
        website: input.website,
        // A substore sits where its mall sits unless the owner says otherwise.
        state: input.state ?? mall.state,
        city: input.city ?? mall.city,
        address: input.address ?? mall.address,
        // Substores need no first payment of their own — a paid mall's new
        // counter opens immediately. Under an unpaid mall they start EXPIRED
        // ("hidden pending the mall's billing"), NOT DRAFT: the payment
        // cascade flips GRACE/EXPIRED to ACTIVE but deliberately never DRAFT,
        // which is reserved for substores the owner archived on purpose.
        status: isVisibleStatus(mall.status) ? 'ACTIVE' : 'EXPIRED',
      },
    }),
    prisma.mall.update({
      where: { id: mall.id },
      data: { substoreCount: { increment: 1 } },
    }),
  ]);

  // The limit check above is check-then-act; concurrent creates can both
  // pass it. Re-verify against the real rows (not the denormalised counter)
  // and roll back if this insert overshot — both racers may retry, but the
  // limit itself is never exceeded.
  if (limit !== null) {
    const actual = await prisma.store.count({
      where: {
        mallId: mall.id,
        kind: 'MALL_SUBSTORE',
        // Archived (DRAFT) substores gave their slot back.
        status: { in: ['ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'BANNED'] },
      },
    });
    if (actual > limit) {
      await prisma.$transaction([
        prisma.store.delete({ where: { id: substore.id } }),
        prisma.mall.update({
          where: { id: mall.id },
          data: { substoreCount: { decrement: 1 } },
        }),
      ]);
      throw createError(409, `Your plan allows up to ${limit} stores`);
    }
  }

  return signStoreBranding(substore);
}

export async function listMySubstores(ownerId: string) {
  const mall = await prisma.mall.findUnique({ where: { ownerId }, select: { id: true } });
  if (!mall) throw createError(404, 'You do not have a mall yet');

  const substores = await prisma.store.findMany({
    where: { mallId: mall.id, kind: 'MALL_SUBSTORE' },
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(substores.map(signStoreBranding));
}

/**
 * Every listing across the mall's substores, one query — built for the
 * featured-products picker, which would otherwise fan out one authenticated
 * request per substore. Capped rather than paginated: the pool exists to be
 * scrolled once, and 500 covers a 20-substore mall comfortably.
 */
export async function listMallListings(
  ownerId: string,
  opts: { status?: 'DRAFT' | 'PUBLISHED' | 'HIDDEN' | 'REMOVED' } = {},
) {
  const mall = await prisma.mall.findUnique({ where: { ownerId }, select: { id: true } });
  if (!mall) throw createError(404, 'You do not have a mall yet');

  const listings = await prisma.product.findMany({
    where: {
      store: { is: { mallId: mall.id, kind: 'MALL_SUBSTORE' } },
      ...(opts.status ? { status: opts.status } : {}),
    },
    include: { store: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return signProductRecords(listings);
}

/**
 * A malformed id would make Prisma-on-Mongo throw ("Malformed ObjectID")
 * before any not-found branch — a 500 for what is really a bad URL.
 */
const OBJECT_ID_RE = /^[0-9a-f]{24}$/;

/** The substore must belong to the caller's mall — anything else is a 404. */
export async function getOwnedSubstore(ownerId: string, substoreId: string) {
  if (!OBJECT_ID_RE.test(substoreId)) throw createError(404, 'Store not found');

  const mall = await prisma.mall.findUnique({ where: { ownerId }, select: { id: true } });
  if (!mall) throw createError(404, 'You do not have a mall yet');

  const substore = await prisma.store.findFirst({
    where: { id: substoreId, mallId: mall.id, kind: 'MALL_SUBSTORE' },
  });
  if (!substore) throw createError(404, 'Store not found');
  return substore;
}

export async function updateSubstore(
  ownerId: string,
  substoreId: string,
  input: UpdateSubstoreInput,
) {
  const substore = await getOwnedSubstore(ownerId, substoreId);

  const slug =
    input.regenerateSlug && input.name ? await buildUniqueStoreSlug(input.name) : undefined;

  return prisma.store.update({
    where: { id: substore.id },
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
      ...(slug ? { slug } : {}),
    },
  });
}

/**
 * Deletes an empty substore, or hides one that has history. A substore with
 * listings, reviews or conversations is worth keeping as a record — flip it
 * to DRAFT (off the mall page and out of browse) instead of destroying it.
 *
 * Only billing-state substores (ACTIVE/GRACE/EXPIRED) can be archived:
 * DRAFT already IS archived (a repeat call must not decrement the counter
 * again — that drift would free phantom plan slots), and SUSPENDED/BANNED
 * are admin state an owner action must never overwrite.
 */
export async function archiveSubstore(ownerId: string, substoreId: string) {
  const substore = await getOwnedSubstore(ownerId, substoreId);

  if (substore.status === 'DRAFT') throw createError(409, 'This store is already archived');
  if (substore.status === 'SUSPENDED' || substore.status === 'BANNED') {
    throw createError(403, 'This store was actioned by an admin. Contact support.');
  }

  const [listings, reviews, conversations] = await Promise.all([
    prisma.product.count({ where: { storeId: substore.id } }),
    prisma.review.count({ where: { storeId: substore.id } }),
    prisma.conversation.count({ where: { storeId: substore.id } }),
  ]);

  if (listings === 0 && reviews === 0 && conversations === 0) {
    await prisma.$transaction([
      prisma.store.delete({ where: { id: substore.id } }),
      prisma.mall.update({
        where: { id: substore.mallId! },
        data: { substoreCount: { decrement: 1 } },
      }),
    ]);
    return { deleted: true as const };
  }

  await prisma.$transaction([
    prisma.store.update({ where: { id: substore.id }, data: { status: 'DRAFT' } }),
    prisma.product.updateMany({
      where: { storeId: substore.id, status: 'PUBLISHED' },
      data: { status: 'HIDDEN' },
    }),
    prisma.mall.update({
      where: { id: substore.mallId! },
      data: { substoreCount: { decrement: 1 } },
    }),
  ]);
  return { deleted: false as const };
}

/**
 * Reopens an archived substore. The mirror of archiveSubstore: it re-takes a
 * plan slot (so the limit is enforced again) and rejoins the billing cascade
 * at whatever visibility the mall currently has. Listings stay HIDDEN — the
 * owner republishes deliberately rather than everything springing back.
 */
export async function restoreSubstore(ownerId: string, substoreId: string) {
  const mall = await requireOwnedMall(ownerId);
  const substore = await getOwnedSubstore(ownerId, substoreId);

  if (substore.status !== 'DRAFT') throw createError(409, 'This store is not archived');

  const limit = mall.subscription?.plan?.substoreLimit ?? null;
  if (limit !== null && mall.substoreCount >= limit) {
    throw createError(409, `Your plan allows up to ${limit} stores`);
  }

  const [restored] = await prisma.$transaction([
    prisma.store.update({
      where: { id: substore.id },
      data: { status: isVisibleStatus(mall.status) ? 'ACTIVE' : 'EXPIRED' },
    }),
    prisma.mall.update({
      where: { id: mall.id },
      data: { substoreCount: { increment: 1 } },
    }),
  ]);
  return signStoreBranding(restored);
}

// ============================================
// Substore status reconciliation
// ============================================

const ALL_MALL_STATUSES = [
  'DRAFT', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'BANNED',
] as const;
const VISIBLE_MALL_STATUSES = ALL_MALL_STATUSES.filter((s) => isVisibleStatus(s));
const HIDDEN_MALL_STATUSES = ALL_MALL_STATUSES.filter((s) => !isVisibleStatus(s));

/** Visible mall, substore stuck EXPIRED → it should be back on air. */
const STRANDED_SUBSTORES: Prisma.StoreWhereInput = {
  kind: 'MALL_SUBSTORE',
  status: 'EXPIRED',
  mall: { is: { status: { in: VISIBLE_MALL_STATUSES } } },
};

/** Hidden mall, substore still showing → the renewal sweep would hide it. */
const OVEREXPOSED_SUBSTORES: Prisma.StoreWhereInput = {
  kind: 'MALL_SUBSTORE',
  status: { in: ['ACTIVE', 'GRACE'] },
  mall: { is: { status: { in: HIDDEN_MALL_STATUSES } } },
};

/**
 * Re-derives the substore statuses that mall visibility owns.
 *
 * Substore status is CASCADED, not derived: it is stamped once at creation
 * and rewritten by the mall's billing transitions. That leaves a gap whenever
 * a mall's visibility changes WITHOUT a billing transition — which is what
 * turning the MALL_PAYWALL flag on and off did in both directions, and what
 * any future direct edit to Mall.status would do again. Stores keep whatever
 * the old rule stamped, the public mall page filters them out, and nothing
 * brings them back: the Stores page offers Restore only on an archived
 * (DRAFT) store, so the owner is left with a permanently invisible
 * storefront. This is the repair, and the guard against a repeat.
 *
 * Only ACTIVE/GRACE/EXPIRED are touched — the same exclusion cascadeSubstores
 * makes. DRAFT is an owner archive, SUSPENDED/BANNED are moderation; neither
 * is visibility's to overwrite.
 *
 * Idempotent: a second run matches nothing. Safe to run on every sweep.
 * `dryRun` counts what would change without writing — for the repair script.
 */
export async function reconcileSubstoreStatuses(
  opts: { dryRun?: boolean } = {},
): Promise<{ revealed: number; hidden: number }> {
  if (opts.dryRun) {
    const [revealed, hidden] = await Promise.all([
      prisma.store.count({ where: STRANDED_SUBSTORES }),
      prisma.store.count({ where: OVEREXPOSED_SUBSTORES }),
    ]);
    return { revealed, hidden };
  }

  const [revealed, hidden] = await prisma.$transaction([
    prisma.store.updateMany({ where: STRANDED_SUBSTORES, data: { status: 'ACTIVE' } }),
    prisma.store.updateMany({ where: OVEREXPOSED_SUBSTORES, data: { status: 'EXPIRED' } }),
  ]);

  return { revealed: revealed.count, hidden: hidden.count };
}

// ============================================
// Owner: featured products
// ============================================

export async function setFeaturedListings(ownerId: string, listingIds: string[]) {
  const mall = await requireOwnedMall(ownerId);

  const unique = [...new Set(listingIds)];
  if (unique.length > MAX_FEATURED_LISTINGS) {
    throw createError(400, `A mall can feature at most ${MAX_FEATURED_LISTINGS} products`);
  }

  if (unique.length > 0) {
    // Every id must be a PUBLISHED listing of one of THIS mall's substores.
    const valid = await prisma.product.count({
      where: {
        id: { in: unique },
        status: 'PUBLISHED',
        store: { is: { mallId: mall.id, kind: 'MALL_SUBSTORE' } },
      },
    });
    if (valid !== unique.length) {
      throw createError(400, 'Featured products must be published listings from your stores');
    }
  }

  return prisma.mall.update({
    where: { id: mall.id },
    data: { featuredListingIds: unique },
  });
}

// ============================================
// Public
// ============================================

/**
 * Public mall page. Null for anything a buyer should not see. Bundles the
 * visible substores and the still-valid featured listings — one call renders
 * the whole page.
 */
export async function getPublicMallBySlug(slug: string) {
  const mall = await prisma.mall.findUnique({ where: { slug }, select: PUBLIC_MALL_SELECT });
  if (!mall || !isVisibleStatus(mall.status)) return null;

  const [substores, featured] = await Promise.all([
    prisma.store.findMany({
      where: { mallId: mall.id, kind: 'MALL_SUBSTORE', status: VISIBLE_STORE_STATUSES },
      select: PUBLIC_STORE_SELECT,
      orderBy: [{ listingCount: 'desc' }, { createdAt: 'asc' }],
    }),
    // Re-filter at read time: a listing hidden or removed since it was
    // featured silently drops out instead of 404ing the rail.
    mall.featuredListingIds.length > 0
      ? prisma.product.findMany({
          where: {
            id: { in: mall.featuredListingIds },
            status: 'PUBLISHED',
            store: { is: { status: VISIBLE_STORE_STATUSES } },
          },
          include: {
            store: { select: { id: true, name: true, slug: true } },
            category: { select: { id: true, name: true, slug: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    ...(await signStoreBranding(mall)),
    substores: await Promise.all(substores.map(signStoreBranding)),
    featuredListings: await signProductRecords(featured),
  };
}

/** Browse: only malls currently paid up. */
export async function listPublicMalls(opts: { page: number; limit: number; state?: string }) {
  const where: Prisma.MallWhereInput = {
    status: VISIBLE_STATUSES,
    ...(opts.state ? { state: opts.state } : {}),
  };

  const [malls, total] = await Promise.all([
    prisma.mall.findMany({
      where,
      select: PUBLIC_MALL_SELECT,
      orderBy: [{ substoreCount: 'desc' }, { createdAt: 'desc' }],
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.mall.count({ where }),
  ]);

  return { malls: await Promise.all(malls.map(signStoreBranding)), total };
}
