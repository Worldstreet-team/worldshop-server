/**
 * Admin category and attribute management.
 *
 * The taxonomy is exactly two levels deep — top-level categories are browse
 * headings, leaves are where listings and attributes live. Every guard in this
 * file exists to keep that invariant true, because `listing.service.ts` relies
 * on it: a listing can only be filed against a leaf, and its attributes come
 * from that leaf's `CategoryAttribute` rows.
 *
 * Attributes are the *structured* layer — controlled vocabulary, validated on
 * publish, and the only thing buyers can filter on. Detail that does not
 * belong in a shared vocabulary is a per-product custom field instead.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { slugify } from '../utils/slugify';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateAttributeInput,
  UpdateAttributeInput,
} from '../validators/admin.category.validator';
import { signCategoryRecord, signCategoryRecords } from '../utils/signUrl';

/**
 * "Has no parent" in MongoDB means either an explicit null or a field that was
 * never written — Prisma treats those as different, so matching only `null`
 * silently omits rows created without the key.
 */
const NO_PARENT = [{ parentId: null }, { parentId: { isSet: false } }];

const CATEGORY_INCLUDE = {
  parent: { select: { id: true, name: true, slug: true } },
  children: { select: { id: true, name: true, slug: true, isActive: true } },
  _count: { select: { products: true, children: true, attributes: true } },
} as const;

async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);
  if (!base) throw createError(400, 'Category name must contain at least one letter or number');

  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const clash = await prisma.category.findFirst({
      where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw createError(409, 'Too many categories share that name — choose another');
}

/**
 * A parent must itself be top-level. Without this the taxonomy silently grows
 * a third level, and vendors start filing listings at inconsistent depths.
 */
async function assertValidParent(parentId: string, selfId?: string) {
  if (selfId && parentId === selfId) throw createError(400, 'A category cannot be its own parent');

  const parent = await prisma.category.findUnique({
    where: { id: parentId },
    select: { id: true, name: true, parentId: true, _count: { select: { products: true } } },
  });
  if (!parent) throw createError(400, 'Parent category not found');

  if (parent.parentId) {
    throw createError(
      400,
      `"${parent.name}" is already a subcategory. The taxonomy is two levels deep, so it cannot have children of its own.`,
    );
  }

  // Turning a leaf into a parent would invalidate every listing already filed
  // against it, since listings may only sit on leaves.
  if (parent._count.products > 0) {
    throw createError(
      409,
      `"${parent.name}" has ${parent._count.products} listing(s) filed against it. ` +
        'Move them to a subcategory before giving it children.',
    );
  }
}

export async function adminListCategories(includeInactive: boolean = true) {
  const where = includeInactive ? {} : { isActive: true };

  const categories = await prisma.category.findMany({
    where,
    include: CATEGORY_INCLUDE,
    orderBy: { sortOrder: 'asc' },
  });

  const mapped = categories.map((cat) => ({
    ...cat,
    productCount: cat._count.products,
    childCount: cat._count.children,
    attributeCount: cat._count.attributes,
    isLeaf: cat._count.children === 0,
    _count: undefined,
  }));

  return signCategoryRecords(mapped);
}

/** The taxonomy as a tree — what an admin UI and the vendor category picker want. */
export async function adminCategoryTree(includeInactive: boolean = true) {
  const where = includeInactive ? {} : { isActive: true };

  const tops = await prisma.category.findMany({
    where: { ...where, OR: NO_PARENT },
    include: {
      children: {
        where: includeInactive ? {} : { isActive: true },
        include: { _count: { select: { products: true, attributes: true } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });

  return tops.map((top) => ({
    id: top.id,
    name: top.name,
    slug: top.slug,
    icon: top.icon,
    isActive: top.isActive,
    sortOrder: top.sortOrder,
    children: top.children.map((child) => ({
      id: child.id,
      name: child.name,
      slug: child.slug,
      isActive: child.isActive,
      sortOrder: child.sortOrder,
      productCount: child._count.products,
      attributeCount: child._count.attributes,
    })),
  }));
}

export async function createCategory(input: CreateCategoryInput) {
  if (input.parentId) await assertValidParent(input.parentId);

  const slug = await uniqueSlug(input.name);

  const category = await prisma.category.create({
    // parentId is written explicitly, even when absent: an unset field and an
    // explicit null are different values in MongoDB, and only one of them
    // matches a `parentId: null` filter.
    data: { ...input, parentId: input.parentId ?? null, slug },
    include: CATEGORY_INCLUDE,
  });

  return signCategoryRecord(category);
}

export async function updateCategory(id: string, input: UpdateCategoryInput) {
  const current = await prisma.category.findUnique({
    where: { id },
    select: { id: true, name: true, _count: { select: { children: true, products: true } } },
  });
  if (!current) throw createError(404, 'Category not found');

  const { regenerateSlug, ...data } = input;

  if (input.parentId) {
    if (current._count.children > 0) {
      throw createError(
        400,
        `"${current.name}" has ${current._count.children} subcategories, so it cannot itself become a subcategory.`,
      );
    }
    await assertValidParent(input.parentId, id);
  }

  const category = await prisma.category.update({
    where: { id },
    data: {
      ...data,
      // Renaming does not move the URL unless asked. Category slugs are in
      // browse links and vendor bookmarks.
      ...(regenerateSlug && input.name ? { slug: await uniqueSlug(input.name, id) } : {}),
    },
    include: CATEGORY_INCLUDE,
  });

  return signCategoryRecord(category);
}

/**
 * Soft-deletes a category. Categories are never hard-deleted — listings point
 * at them, and removing the row would orphan live data.
 *
 * Deactivating a parent deactivates its children too. The previous behaviour
 * detached them (`parentId: null`), which quietly promoted subcategories to
 * top-level headings — and every listing filed against them instantly became
 * unpublishable, since listings may only sit on leaves.
 */
export async function deleteCategory(id: string, moveProductsTo?: string) {
  const category = await prisma.category.findUnique({
    where: { id },
    select: { id: true, name: true, _count: { select: { products: true, children: true } } },
  });
  if (!category) throw createError(404, 'Category not found');

  if (moveProductsTo) {
    const target = await prisma.category.findUnique({
      where: { id: moveProductsTo },
      select: { id: true, name: true, isActive: true, _count: { select: { children: true } } },
    });
    if (!target) throw createError(400, 'Target category not found');
    if (target.id === id) throw createError(400, 'Cannot move listings into the category being removed');
    if (target._count.children > 0) {
      throw createError(400, `"${target.name}" is a top-level category — listings can only be moved to a subcategory`);
    }
    if (!target.isActive) throw createError(400, `"${target.name}" is inactive`);

    await prisma.product.updateMany({ where: { categoryId: id }, data: { categoryId: moveProductsTo } });
  }

  const childIds = (
    await prisma.category.findMany({ where: { parentId: id }, select: { id: true } })
  ).map((c) => c.id);

  const [updated] = await prisma.$transaction([
    prisma.category.update({ where: { id }, data: { isActive: false } }),
    ...(childIds.length
      ? [prisma.category.updateMany({ where: { id: { in: childIds } }, data: { isActive: false } })]
      : []),
  ]);

  const strandedListings = await prisma.product.count({
    where: { categoryId: { in: [id, ...childIds] } },
  });

  return {
    category: updated,
    deactivatedChildren: childIds.length,
    // Not an error — existing listings keep working, but they cannot be
    // republished until they are re-filed, so the admin should know.
    listingsNeedingRefile: moveProductsTo ? 0 : strandedListings,
  };
}

export async function getCategoryById(id: string) {
  const cat = await prisma.category.findUnique({
    where: { id },
    include: { ...CATEGORY_INCLUDE, attributes: { orderBy: { sortOrder: 'asc' } } },
  });

  return cat ? signCategoryRecord(cat) : null;
}

// ── Attributes ──

/** Attributes describe listings, and listings only sit on leaves. */
async function assertLeaf(categoryId: string) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, _count: { select: { children: true } } },
  });
  if (!category) throw createError(404, 'Category not found');
  if (category._count.children > 0) {
    throw createError(
      400,
      `"${category.name}" is a top-level category. Attributes belong on the subcategories that listings are filed against.`,
    );
  }
  return category;
}

export async function listAttributes(categoryId: string) {
  await assertLeaf(categoryId);
  return prisma.categoryAttribute.findMany({
    where: { categoryId },
    orderBy: { sortOrder: 'asc' },
  });
}

export async function createAttribute(categoryId: string, input: CreateAttributeInput) {
  await assertLeaf(categoryId);

  const clash = await prisma.categoryAttribute.findFirst({
    where: { categoryId, name: { equals: input.name, mode: 'insensitive' } },
    select: { name: true },
  });
  if (clash) throw createError(409, `This category already has an attribute named "${clash.name}"`);

  return prisma.categoryAttribute.create({
    data: {
      categoryId,
      ...input,
      // Only a controlled vocabulary makes a usable facet.
      isFilterable: input.isFilterable ?? input.type === 'SELECT',
    },
  });
}

export type AttributeUpdateResult = {
  attribute: Awaited<ReturnType<typeof prisma.categoryAttribute.update>>;
  /** Listings whose stored value is no longer valid after this change. */
  listingsNowInvalid: number;
};

/**
 * Updates an attribute definition and reports how many existing listings the
 * change invalidates.
 *
 * Removing an option, or making an optional attribute required, does not break
 * live listings — they stay visible — but it does block their next publish. The
 * count is returned rather than the change refused: tightening standards is a
 * legitimate admin action, and the admin should simply see the blast radius.
 */
export async function updateAttribute(
  categoryId: string,
  attributeId: string,
  input: UpdateAttributeInput,
): Promise<AttributeUpdateResult> {
  await assertLeaf(categoryId);

  const existing = await prisma.categoryAttribute.findFirst({
    where: { id: attributeId, categoryId },
  });
  if (!existing) throw createError(404, 'Attribute not found');

  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await prisma.categoryAttribute.findFirst({
      where: { categoryId, name: { equals: input.name, mode: 'insensitive' }, id: { not: attributeId } },
      select: { id: true },
    });
    if (clash) throw createError(409, `This category already has an attribute named "${input.name}"`);
  }

  const nextType = input.type ?? existing.type;
  const nextOptions = input.options ?? existing.options;
  if (nextType === 'SELECT' && nextOptions.length === 0) {
    throw createError(400, 'A SELECT attribute needs at least one option');
  }

  const attribute = await prisma.categoryAttribute.update({
    where: { id: attributeId },
    data: {
      ...input,
      ...(input.type && input.type !== 'SELECT' ? { isFilterable: false } : {}),
    },
  });

  return {
    attribute,
    listingsNowInvalid: await countInvalidListings(categoryId, attribute.name, nextType, nextOptions, attribute.isRequired),
  };
}

/**
 * How many listings in this category hold a value this definition would now
 * reject — or are missing a value that just became required.
 *
 * Counted in application code rather than a query: the values live inside a
 * JSON column, and Mongo cannot express "key exists but is outside this list"
 * without a scan anyway. Categories hold thousands of listings at most.
 */
async function countInvalidListings(
  categoryId: string,
  name: string,
  type: string,
  options: string[],
  isRequired: boolean,
): Promise<number> {
  const listings = await prisma.product.findMany({
    where: { categoryId },
    select: { attributes: true },
  });

  let invalid = 0;
  for (const listing of listings) {
    const attrs = (listing.attributes ?? {}) as Record<string, unknown>;
    const raw = attrs[name] ?? attrs[name.toLowerCase()];
    const value = raw == null || raw === '' ? undefined : String(raw);

    if (!value) {
      if (isRequired) invalid += 1;
      continue;
    }
    if (type === 'SELECT' && options.length > 0 && !options.includes(value)) invalid += 1;
    if (type === 'NUMBER' && Number.isNaN(Number(value))) invalid += 1;
  }
  return invalid;
}

/**
 * Deletes an attribute definition. Listings keep whatever value they stored —
 * the key simply becomes an orphan, and their next update is rejected for
 * referencing an attribute the category no longer defines. So the count is
 * reported, and a non-zero count needs `force`.
 */
export async function deleteAttribute(categoryId: string, attributeId: string, force = false) {
  await assertLeaf(categoryId);

  const attribute = await prisma.categoryAttribute.findFirst({
    where: { id: attributeId, categoryId },
  });
  if (!attribute) throw createError(404, 'Attribute not found');

  const listings = await prisma.product.findMany({
    where: { categoryId },
    select: { id: true, attributes: true },
  });
  const affected = listings.filter((l) => {
    const attrs = (l.attributes ?? {}) as Record<string, unknown>;
    return attrs[attribute.name] != null || attrs[attribute.name.toLowerCase()] != null;
  });

  if (affected.length && !force) {
    throw createError(
      409,
      `${affected.length} listing(s) have a value for "${attribute.name}". ` +
        'Pass force=true to delete it anyway — those values will be cleared.',
    );
  }

  // Clear the orphaned key so vendors are not blocked from editing later.
  for (const listing of affected) {
    const attrs = { ...((listing.attributes ?? {}) as Record<string, unknown>) };
    delete attrs[attribute.name];
    delete attrs[attribute.name.toLowerCase()];
    await prisma.product.update({
      where: { id: listing.id },
      data: { attributes: attrs as never },
    });
  }

  await prisma.categoryAttribute.delete({ where: { id: attributeId } });

  return { deleted: attribute.name, listingsCleared: affected.length };
}

/** Bulk reorder for drag-and-drop in the admin UI. */
export async function reorderAttributes(categoryId: string, orderedIds: string[]) {
  await assertLeaf(categoryId);

  const owned = await prisma.categoryAttribute.findMany({
    where: { categoryId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((a) => a.id));
  const foreign = orderedIds.filter((id) => !ownedIds.has(id));
  if (foreign.length) throw createError(400, 'One or more attributes do not belong to this category');

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.categoryAttribute.update({ where: { id }, data: { sortOrder: index * 10 } }),
    ),
  );

  return listAttributes(categoryId);
}
