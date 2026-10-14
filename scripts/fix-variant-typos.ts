/**
 * Finds variant names that are a near-miss of their own attribute values
 * ("Balck" on a variant whose Colour is "Black") and, with --apply, renames
 * them to the attribute value.
 *
 * The attribute values come from the category's controlled vocabulary, so
 * when the free-typed name is one or two keystrokes away from one of them,
 * the vocabulary is the spelling the seller meant. Names that differ by more
 * than that are left alone: "Black, gold chain" is a description, not a typo.
 *
 *   npm run fix:variant-typos             # dry run: lists what would change
 *   npm run fix:variant-typos -- --apply
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');
const MAX_EDITS = 2;
// Below this a one-letter change is a different word ("Red" / "Rad").
const MIN_LENGTH = 4;

/** Damerau-Levenshtein (optimal string alignment): a swap counts as one edit. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function suggestion(name: string, attributes: unknown): string | null {
  if (!attributes || typeof attributes !== 'object') return null;
  const values = Object.values(attributes as Record<string, unknown>).filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  const typed = name.trim().toLowerCase();
  if (typed.length < MIN_LENGTH) return null;
  // Already spelled like one of its values (any case): nothing to fix.
  if (values.some((v) => v.trim().toLowerCase() === typed)) return null;

  const close = values.filter((v) => {
    const edits = distance(typed, v.trim().toLowerCase());
    return edits > 0 && edits <= MAX_EDITS;
  });
  // Two candidates means the intent is not clear; leave it for a person.
  return close.length === 1 ? close[0].trim() : null;
}

async function main() {
  const variants = await prisma.productVariant.findMany({
    select: { id: true, name: true, attributes: true, product: { select: { name: true, slug: true } } },
  });
  console.log(`${variants.length} variants. ${apply ? 'Applying.' : 'Dry run: nothing is written. Pass --apply to write.'}`);

  let found = 0;
  for (const v of variants) {
    const next = suggestion(v.name, v.attributes);
    if (!next) continue;
    found += 1;
    console.log(`  ${v.product.slug}: "${v.name}" -> "${next}"`);
    if (apply) await prisma.productVariant.update({ where: { id: v.id }, data: { name: next } });
  }
  console.log(`${found} variant name${found === 1 ? '' : 's'} ${apply ? 'fixed' : 'to fix'}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
