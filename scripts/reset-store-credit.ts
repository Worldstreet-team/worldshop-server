/**
 * Zeroes every store's subscription credit.
 *
 *   npm run reset:credit              # dry run
 *   npm run reset:credit -- --apply
 *
 * Written after an audit (2026-07-26) found that the vendor balances converted
 * into credit were backed by Flutterwave TEST-mode transactions: the payments
 * verified cleanly against the sandbox, but no money ever moved. Only one real
 * charge has ever reached the platform ($3.49, order WS-20260710-T8R6A), and
 * that buyer was the platform owner, who waived it.
 *
 * The credit is removed by writing a REVERSAL entry per store rather than by
 * overwriting the balance, so the audit trail shows the grant, the reversal
 * and the reason. `Store.creditMinor` is only ever the running total of those
 * entries.
 *
 * Idempotent: a store already at zero is skipped, so re-running is a no-op.
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';
import { recordCredit } from '../src/services/store-credit.service';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');
const NOTE =
  process.argv.find((a) => a.startsWith('--note='))?.split('=')[1] ??
  'Audit 2026-07-26: source balances were Flutterwave test-mode transactions, no real funds';

async function main() {
  console.log(apply ? 'APPLYING' : 'DRY RUN (re-run with --apply)', '\n');

  const stores = await prisma.store.findMany({
    where: { creditMinor: { not: 0 } },
    select: { id: true, name: true, creditMinor: true },
    orderBy: { creditMinor: 'desc' },
  });

  if (!stores.length) {
    console.log('Every store is already at zero credit.');
    return;
  }

  let totalMinor = 0;

  for (const store of stores) {
    console.log(
      `  ${store.name.slice(0, 30).padEnd(32)} $${(store.creditMinor / 100).toFixed(2).padStart(9)} → $0.00`,
    );
    totalMinor += store.creditMinor;

    if (!apply) continue;

    await recordCredit({
      storeId: store.id,
      type: 'REVERSAL',
      amountMinor: -store.creditMinor,
      reference: `credit-reset:${store.id}`,
      note: NOTE,
    });
  }

  console.log(
    `\n${apply ? 'Removed' : 'Would remove'} $${(totalMinor / 100).toFixed(2)} of credit across ${stores.length} store(s).`,
  );

  if (apply) {
    const remaining = await prisma.store.count({ where: { creditMinor: { not: 0 } } });
    console.log(`Stores still holding credit: ${remaining}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
