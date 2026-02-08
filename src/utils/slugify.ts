/**
 * slugify — Converts a string into a URL-friendly slug.
 * Example: "Men's Running Shoes" → "mens-running-shoes"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')           // remove apostrophes
    .replace(/[^\w\s-]/g, '')       // remove non-word chars
    .replace(/[\s_]+/g, '-')        // spaces/underscores → hyphens
    .replace(/-+/g, '-')            // collapse multiple hyphens
    .replace(/^-+|-+$/g, '');       // trim leading/trailing hyphens
}
