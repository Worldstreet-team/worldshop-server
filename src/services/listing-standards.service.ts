import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import type { CategoryAttribute } from '../../generated/prisma';

/**
 * Listing standards (Test 8): what a vendor must provide before a listing is
 * considered complete, driven by the product's category via CategoryAttribute
 * rows. Used two ways:
 *  - assertListingStandards: hard gate on vendor create/update (throws 400)
 *  - computeCompliance: annotation for existing listings, so pre-standards
 *    products stay live but are flagged "update required" in the vendor UI.
 */

export interface ListingState {
  categoryId: string | null;
  type: string;
  images: unknown;
  brand?: string | null;
  material?: string | null;
  /**
   * Values for the admin-defined PRODUCT-level attributes, keyed by attribute
   * name. Before this existed, only `brand` and `material` could be enforced
   * because they were the only columns to put a value in; anything else the
   * admin defined was advisory. Now any PRODUCT attribute is enforceable.
   */
  attributes?: Record<string, unknown> | null;
  variants: Array<{ attributes: unknown }>;
}

export interface ComplianceResult {
  compliant: boolean;
  problems: string[];
}

// PRODUCT-level category attributes are enforced against real Product columns.
// Attribute names not in this map can be displayed by the form but cannot be
// hard-enforced (there is nowhere to store them yet).
const PRODUCT_FIELDS: Record<string, 'brand' | 'material'> = {
  brand: 'brand',
  material: 'material',
};

function imageCount(images: unknown): number {
  return Array.isArray(images) ? images.length : 0;
}

function variantAttributes(variant: { attributes: unknown }): Record<string, string> {
  return variant.attributes && typeof variant.attributes === 'object' && !Array.isArray(variant.attributes)
    ? (variant.attributes as Record<string, string>)
    : {};
}

export async function getCategoryAttributes(categoryId: string): Promise<CategoryAttribute[]> {
  return prisma.categoryAttribute.findMany({
    where: { categoryId },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * Pure check of a listing state against its category's attribute rules.
 * Returns every problem, not just the first, so the vendor can fix them all
 * in one pass.
 */
export function computeCompliance(
  state: ListingState,
  attributes: CategoryAttribute[],
): ComplianceResult {
  const problems: string[] = [];

  if (!state.categoryId) {
    problems.push('A category is required');
  }

  if (state.type === 'PHYSICAL' && imageCount(state.images) === 0) {
    problems.push('At least one product image is required');
  }

  for (const attr of attributes) {
    if (attr.appliesTo === 'PRODUCT') {
      // Prefer the structured attribute map; fall back to the legacy columns
      // so listings written before the map existed still validate.
      const legacyField = PRODUCT_FIELDS[attr.name.toLowerCase()];
      const raw =
        state.attributes?.[attr.name] ??
        state.attributes?.[attr.name.toLowerCase()] ??
        (legacyField ? state[legacyField] : undefined);
      const value = raw == null || raw === '' ? undefined : String(raw);

      if (attr.isRequired && !value) {
        problems.push(`${attr.name} is required for this category`);
        continue;
      }
      if (!value) continue;

      if (attr.type === 'SELECT' && attr.options.length > 0 && !attr.options.includes(value)) {
        problems.push(
          `"${value}" is not a valid ${attr.name} (allowed: ${attr.options.join(', ')})`,
        );
      }
      if (attr.type === 'NUMBER' && Number.isNaN(Number(value))) {
        problems.push(`${attr.name} must be a number`);
      }
      continue;
    }

    // VARIANT-level
    if (attr.isRequired && state.variants.length === 0) {
      problems.push(`This category requires variants with ${attr.name} (e.g. one per ${attr.name.toLowerCase()})`);
      continue;
    }

    state.variants.forEach((variant, index) => {
      const attrs = variantAttributes(variant);
      const value = attrs[attr.name] ?? attrs[attr.name.toLowerCase()];

      if (attr.isRequired && !value) {
        problems.push(`Variant ${index + 1} is missing ${attr.name}`);
        return;
      }
      if (value && attr.type === 'SELECT' && attr.options.length > 0 && !attr.options.includes(value)) {
        problems.push(
          `Variant ${index + 1}: "${value}" is not a valid ${attr.name} (allowed: ${attr.options.join(', ')})`,
        );
      }
    });
  }

  return { compliant: problems.length === 0, problems };
}

/** Hard gate for vendor create/update — throws 400 listing every problem. */
export async function assertListingStandards(state: ListingState): Promise<void> {
  const attributes = state.categoryId
    ? await getCategoryAttributes(state.categoryId)
    : [];
  const { compliant, problems } = computeCompliance(state, attributes);

  if (!compliant) {
    throw createError(400, `Listing does not meet the requirements: ${problems.join('; ')}`);
  }
}

/**
 * Batch compliance annotation for vendor product lists — one attribute query
 * for all categories on the page.
 */
export async function annotateCompliance<
  T extends {
    categoryId: string | null;
    type: string;
    images: unknown;
    brand: string | null;
    material: string | null;
    variants: Array<{ attributes: unknown }>;
  },
>(products: T[]): Promise<Array<T & { compliance: ComplianceResult }>> {
  const categoryIds = [...new Set(products.map((p) => p.categoryId).filter((id): id is string => !!id))];
  const attributes = categoryIds.length
    ? await prisma.categoryAttribute.findMany({ where: { categoryId: { in: categoryIds } } })
    : [];

  const byCategory = new Map<string, CategoryAttribute[]>();
  for (const attr of attributes) {
    const list = byCategory.get(attr.categoryId) ?? [];
    list.push(attr);
    byCategory.set(attr.categoryId, list);
  }

  return products.map((product) => ({
    ...product,
    compliance: computeCompliance(
      product,
      product.categoryId ? (byCategory.get(product.categoryId) ?? []) : [],
    ),
  }));
}
