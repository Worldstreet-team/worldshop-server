/**
 * Vendor listing management for the marketplace model.
 *
 * Two independent gates decide whether a listing is publicly visible:
 *
 *   1. the LISTING is PUBLISHED   — the vendor says it's ready
 *   2. the STORE is paid up       — ACTIVE or GRACE
 *
 * Both must be open. Vendors can build their whole catalogue and mark it
 * published while still unpaid; nothing is public, and the moment the
 * subscription fee clears everything appears at once. That ordering matters — asking someone to
 * pay before they can see their own shop populated is a much worse sell than
 * showing them a finished storefront behind a paywall.
 *
 * Detail is captured in two layers:
 *   - `attributes`   — values for the admin's CategoryAttribute set. Controlled
 *                      vocabulary, validated, and therefore filterable.
 *   - `customFields` — free-form rows the vendor invents per product. Shown as
 *                      a spec table, never used as a filter.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { slugify } from '../utils/slugify';
import {
  annotateCompliance,
  assertListingStandards,
  getCategoryAttributes,
} from './listing-standards.service';
import { signProductRecord, signProductRecords, signStoreBranding } from '../utils/signUrl';
import { isVisibleStatus } from './subscription.service';
import { Prisma } from '../../generated/prisma';
import type {
  CreateListingInput,
  UpdateListingInput,
  ListingQueryInput,
} from '../validators/listing.validator';

/** Statuses that make a store's published listings visible to buyers. */
const VISIBLE_STORE_STATUSES: Prisma.EnumStoreStatusFilter = { in: ['ACTIVE', 'GRACE'] };

async function buildUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'listing';
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const taken = await prisma.product.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Categories are two levels deep and listings attach to a leaf. A parent
 * category is a browse heading, not a place to file a product — allowing both
 * would split the same products across two levels and make filtering
 * inconsistent.
 */
async function assertLeafCategory(categoryId: string) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, isActive: true, parentId: true, _count: { select: { children: true } } },
  });

  if (!category || !category.isActive) throw createError(400, 'That category is not available');
  if (category._count.children > 0) {
    throw createError(400, `"${category.name}" is a top-level category — choose one of its subcategories`);
  }
  return category;
}

/**
 * Rejects attribute values the category does not define. Silently dropping
 * them would leave the vendor believing they had recorded something that
 * search will never see.
 */
async function assertKnownAttributes(categoryId: string, attributes?: Record<string, unknown>) {
  if (!attributes || Object.keys(attributes).length === 0) return;

  const defined = await getCategoryAttributes(categoryId);
  const names = new Set(defined.map((a) => a.name.toLowerCase()));
  const unknown = Object.keys(attributes).filter((k) => !names.has(k.toLowerCase()));

  if (unknown.length) {
    throw createError(
      400,
      `This category has no attribute named ${unknown.map((u) => `"${u}"`).join(', ')}. ` +
        'Use a custom field for details the category does not define.',
    );
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function createListing(
  store: { id: string; state: string; city: string | null },
  input: CreateListingInput,
) {
  await assertLeafCategory(input.categoryId);
  await assertKnownAttributes(input.categoryId, input.attributes);

  const slug = await buildUniqueSlug(input.name);

  return prisma.product.create({
    data: {
      name: input.name,
      slug,
      description: input.description,
      shortDesc: input.shortDesc,
      categoryId: input.categoryId,
      storeId: store.id,

      priceType: input.priceType,
      // Kept non-null for the legacy ecommerce columns; ON_REQUEST listings
      // carry 0 and are rendered as "contact for price".
      basePrice: input.basePrice ?? 0,
      maxPrice: input.maxPrice,
      isNegotiable: input.isNegotiable,

      condition: input.condition,
      brand: input.brand,
      material: input.material,
      tags: input.tags,
      images: toJson(input.images),
      attributes: input.attributes ? toJson(input.attributes) : undefined,
      customFields: toJson(input.customFields.map((f, i) => ({ ...f, sortOrder: i }))),

      state: input.state ?? store.state,
      city: input.city ?? store.city,

      status: 'DRAFT',
      variants: input.variants.length
        ? {
            create: input.variants.map((v) => ({
              name: v.name,
              attributes: toJson(v.attributes),
              price: v.price,
              isAvailable: v.isAvailable ?? true,
              images: toJson(v.images ?? []),
            })),
          }
        : undefined,
    },
    include: { variants: true, category: true },
  });
}

async function ownedListing(storeId: string, listingId: string) {
  const listing = await prisma.product.findFirst({
    where: { id: listingId, storeId },
    include: { variants: true },
  });
  if (!listing) throw createError(404, 'Listing not found');
  return listing;
}

export async function updateListing(storeId: string, listingId: string, input: UpdateListingInput) {
  const listing = await ownedListing(storeId, listingId);

  if (listing.status === 'REMOVED') {
    throw createError(403, 'This listing was removed by an administrator and cannot be edited');
  }

  const categoryId = input.categoryId ?? listing.categoryId;
  if (input.categoryId) await assertLeafCategory(input.categoryId);
  if (input.attributes && categoryId) await assertKnownAttributes(categoryId, input.attributes);

  // Variants are replaced wholesale: the vendor UI edits them as one table,
  // and diffing rows by index silently reassigns photos when one is deleted.
  if (input.variants) {
    await prisma.productVariant.deleteMany({ where: { productId: listingId } });
  }

  return prisma.product.update({
    where: { id: listingId },
    data: {
      name: input.name,
      description: input.description,
      shortDesc: input.shortDesc,
      categoryId: input.categoryId,
      priceType: input.priceType,
      basePrice: input.basePrice ?? undefined,
      maxPrice: input.maxPrice,
      isNegotiable: input.isNegotiable,
      condition: input.condition,
      brand: input.brand,
      material: input.material,
      tags: input.tags,
      images: input.images ? toJson(input.images) : undefined,
      attributes: input.attributes ? toJson(input.attributes) : undefined,
      customFields: input.customFields
        ? toJson(input.customFields.map((f, i) => ({ ...f, sortOrder: i })))
        : undefined,
      state: input.state,
      city: input.city,
      ...(input.variants
        ? {
            variants: {
              create: input.variants.map((v) => ({
                name: v.name,
                attributes: toJson(v.attributes),
                price: v.price,
                isAvailable: v.isAvailable ?? true,
                images: toJson(v.images ?? []),
              })),
            },
          }
        : {}),
    },
    include: { variants: true, category: true },
  });
}

export type PublishResult = {
  listing: { id: string; status: string; publishedAt: Date | null };
  publiclyVisible: boolean;
  message: string;
};

/**
 * Marks a listing ready. Enforces the category's listing standards first —
 * this is the point where "well-detailed" stops being a hope and becomes a
 * requirement, since required attributes and at least one image are checked.
 *
 * Publishing an unpaid store's listing is allowed and reports back that it is
 * not yet live, rather than failing.
 */
export async function publishListing(
  store: { id: string; status: string },
  listingId: string,
): Promise<PublishResult> {
  const listing = await ownedListing(store.id, listingId);

  if (listing.status === 'REMOVED') {
    throw createError(403, 'This listing was removed by an administrator');
  }

  // Checked again at publish, not just at create/update. A listing can end up
  // on a parent category without either of those running — a pre-pivot listing
  // whose flat category later gained children, or an admin adding children to a
  // category that already had listings. Publishing one puts an unfilterable
  // item into browse, because attributes live on the leaf.
  if (!listing.categoryId) throw createError(400, 'Choose a category before publishing');
  await assertLeafCategory(listing.categoryId);

  await assertListingStandards({
    categoryId: listing.categoryId,
    images: listing.images,
    brand: listing.brand,
    material: listing.material,
    attributes: (listing.attributes as Record<string, unknown> | null) ?? null,
    variants: listing.variants,
  });

  const updated = await prisma.product.update({
    where: { id: listingId },
    data: {
      status: 'PUBLISHED',
      publishedAt: listing.publishedAt ?? new Date(),
      isActive: true,
    },
    select: { id: true, status: true, publishedAt: true },
  });

  await refreshListingCount(store.id);

  const publiclyVisible = isVisibleStatus(store.status);
  return {
    listing: updated,
    publiclyVisible,
    message: publiclyVisible
      ? 'Listing is live.'
      : 'Listing is ready. It becomes visible to buyers as soon as your subscription is active.',
  };
}

export async function unpublishListing(storeId: string, listingId: string) {
  await ownedListing(storeId, listingId);
  const updated = await prisma.product.update({
    where: { id: listingId },
    data: { status: 'HIDDEN', isActive: false },
    select: { id: true, status: true },
  });
  await refreshListingCount(storeId);
  return updated;
}

export async function deleteListing(storeId: string, listingId: string) {
  await ownedListing(storeId, listingId);
  await prisma.productVariant.deleteMany({ where: { productId: listingId } });
  await prisma.product.delete({ where: { id: listingId } });
  await refreshListingCount(storeId);
}

/** Keeps Store.listingCount honest — it drives store cards and browse sorting. */
async function refreshListingCount(storeId: string) {
  const count = await prisma.product.count({ where: { storeId, status: 'PUBLISHED' } });
  await prisma.store.update({ where: { id: storeId }, data: { listingCount: count } });
}

export async function listMyListings(storeId: string, query: ListingQueryInput) {
  const where: Prisma.ProductWhereInput = {
    storeId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const [listings, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { variants: true, category: { select: { id: true, name: true, slug: true } } },
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.product.count({ where }),
  ]);

  // Annotated here rather than only at publish time: the vendor needs to see
  // what is blocking a draft on the list itself, without having to click
  // Publish and catch a toast that disappears.
  const annotated = await annotateCompliance(listings);
  return { listings: await signProductRecords(annotated), total };
}

export async function getMyListing(storeId: string, listingId: string) {
  const listing = await prisma.product.findFirst({
    where: { id: listingId, storeId },
    include: { variants: true, category: true },
  });
  return listing ? signProductRecord(listing) : listing;
}

/**
 * The form contract for a category: which attributes the vendor must fill,
 * which values are allowed, and which of them buyers can filter on. The vendor
 * UI renders its dynamic fields from this.
 */
export async function getCategoryFormSpec(categoryId: string) {
  const category = await assertLeafCategory(categoryId);
  const attributes = await getCategoryAttributes(categoryId);

  return {
    categoryId: category.id,
    attributes: attributes.map((a) => ({
      name: a.name,
      type: a.type,
      options: a.options,
      isRequired: a.isRequired,
      appliesTo: a.appliesTo,
      isFilterable: a.isFilterable,
      sortOrder: a.sortOrder,
    })),
    customFieldsAllowed: true,
  };
}

/** What a buyer needs to decide whether to make contact. */
const PUBLIC_LISTING_INCLUDE = {
  variants: true,
  category: { select: { id: true, name: true, slug: true, parentId: true } },
  store: {
    select: {
      id: true, name: true, slug: true, logo: true, verificationTier: true,
      state: true, city: true, phone: true, whatsapp: true, website: true,
      avgRating: true, reviewCount: true, listingCount: true,
      // Attentiveness matters as much as rating when nothing is transacted
      // on-platform, so it travels with the listing.
      responseRate: true, avgResponseMins: true, createdAt: true,
    },
  },
} as const;

/**
 * A single public listing, by id or slug.
 *
 * Both gates apply, and a listing failing either is reported as missing rather
 * than hidden-but-acknowledged: whether an unpaid store has a listing is not
 * something the public needs to know.
 */
export async function getPublicListing(idOrSlug: string) {
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrSlug);

  const listing = await prisma.product.findFirst({
    where: {
      ...(isObjectId ? { id: idOrSlug } : { slug: idOrSlug }),
      status: 'PUBLISHED',
      store: { is: { status: VISIBLE_STORE_STATUSES } },
    },
    include: PUBLIC_LISTING_INCLUDE,
  });
  if (!listing) return null;

  // Counted for the vendor's dashboard. Deliberately not awaited — a slow
  // counter update should never delay the page a buyer is waiting for.
  prisma.product
    .update({ where: { id: listing.id }, data: { viewCount: { increment: 1 } } })
    .catch(() => undefined);

  const signed = await signProductRecord(listing);
  if (signed.store) signed.store = await signStoreBranding(signed.store);
  return signed;
}

/** A store's public catalogue, for its storefront page. */
export async function listStoreListings(
  storeId: string,
  opts: { page: number; limit: number; categoryId?: string; search?: string },
) {
  const where: Prisma.ProductWhereInput = {
    storeId,
    status: 'PUBLISHED',
    ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
    ...(opts.search ? { name: { contains: opts.search, mode: 'insensitive' } } : {}),
  };

  const [listings, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        variants: true,
        category: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.product.count({ where }),
  ]);

  return { listings: await signProductRecords(listings), total };
}

/** Public browse. Both gates enforced here, in one place. */
export async function listPublicListings(query: {
  page: number;
  limit: number;
  categoryId?: string;
  state?: string;
  search?: string;
  /**
   * A first-class column rather than a category attribute, so it filters
   * uniformly across every category instead of being redefined per leaf.
   */
  condition?: string;
  /** Attribute facets, e.g. { Size: 'XL' } — only matches the structured layer. */
  attributes?: Record<string, string>;
}) {
  const where: Prisma.ProductWhereInput = {
    status: 'PUBLISHED',
    store: { is: { status: VISIBLE_STORE_STATUSES } },
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.state ? { state: query.state } : {}),
    ...(query.condition ? { condition: query.condition } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    ...(query.attributes && Object.keys(query.attributes).length
      ? {
          AND: Object.entries(query.attributes).map(([name, value]) => ({
            attributes: { equals: { [name]: value } } as Prisma.JsonFilter,
          })),
        }
      : {}),
  };

  const [listings, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        variants: true,
        category: { select: { id: true, name: true, slug: true } },
        store: { select: { id: true, name: true, slug: true, state: true, verificationTier: true } },
      },
      orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.product.count({ where }),
  ]);

  return { listings: await signProductRecords(listings), total };
}
