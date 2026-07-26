/**
 * Converts pre-pivot VendorBalance rows into subscription credit.
 *
 *   npm run convert:balances              # dry run — shows the FX rate and every amount
 *   npm run convert:balances -- --apply
 *
 * In the old model these balances were sales revenue the platform owed
 * vendors. In the new model the platform sells visibility, so the obligation
 * is honoured as credit against future subscription charges rather than as a
 * payout.
 *
 * Two currencies are involved: balances are NGN, subscriptions are USD. The
 * rate is snapshotted at conversion time from the same source the wallet
 * service uses, and recorded in the ledger note so the conversion can always
 * be explained. Rounding is UP, in the vendor's favour.
 *
 * Requires scripts/backfill-stores.ts to have run — credit attaches to a
 * Store, so a vendor without one cannot be converted (they are reported, not
 * skipped silently).
 *
 * Idempotent: each conversion is keyed `migrated-balance:<vendorId>`, so
 * re-running credits nobody twice. VendorBalance rows are left intact — this
 * script does not delete them, so the conversion stays reversible until the
 * `financial` teardown phase runs.
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';
import { recordCredit } from '../src/services/store-credit.service';
import { getUsdNgnRate } from '../src/services/payment/providers/wallet.provider';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');

/** Allows a fixed rate when the live one is disputed: --rate=1650 */
const rateArg = process.argv.find((a) => a.startsWith('--rate='))?.split('=')[1];

function ngnToUsdMinor(amountNgn: number, rate: number): number {
  return Math.ceil((amountNgn / rate) * 100);
}

async function main() {
  console.log(apply ? 'APPLYING' : 'DRY RUN (re-run with --apply)', '\n');

  const rate = rateArg ? Number(rateArg) : await getUsdNgnRate();
  if (!(rate > 0)) {
    console.error('Could not determine a USD/NGN rate. Pass one explicitly with --rate=<ngn per usd>.');
    process.exit(1);
  }
  console.log(`USD/NGN rate: ₦${rate.toLocaleString()} per $1${rateArg ? ' (fixed)' : ' (live)'}\n`);

  const balances = await prisma.vendorBalance.findMany({
    where: { availableBalance: { gt: 0 } },
    orderBy: { availableBalance: 'desc' },
  });

  if (!balances.length) {
    console.log('No positive vendor balances to convert.');
    return;
  }

  let converted = 0;
  let skipped = 0;
  let totalNgn = 0;
  let totalUsdMinor = 0;
  const missingStores: string[] = [];

  for (const balance of balances) {
    const store = await prisma.store.findUnique({
      where: { ownerId: balance.vendorId },
      select: { id: true, name: true, creditMinor: true },
    });

    if (!store) {
      missingStores.push(balance.vendorId);
      continue;
    }

    const usdMinor = ngnToUsdMinor(balance.availableBalance, rate);
    const reference = `migrated-balance:${balance.vendorId}`;

    const already = await prisma.storeCreditEntry.findUnique({ where: { reference } });
    if (already) {
      skipped += 1;
      console.log(`  ${store.name.slice(0, 26).padEnd(28)} already converted`);
      continue;
    }

    const months = Math.floor(usdMinor / 500);
    console.log(
      `  ${store.name.slice(0, 26).padEnd(28)} ₦${balance.availableBalance.toLocaleString().padStart(9)}` +
        ` → $${(usdMinor / 100).toFixed(2).padStart(8)}  (~${months} months)`,
    );

    totalNgn += balance.availableBalance;
    totalUsdMinor += usdMinor;
    converted += 1;

    if (!apply) continue;

    await recordCredit({
      storeId: store.id,
      type: 'MIGRATED_BALANCE',
      amountMinor: usdMinor,
      reference,
      note: `Converted ₦${balance.availableBalance.toLocaleString()} vendor balance at ₦${rate}/$`,
    });
  }

  console.log(
    `\n${apply ? 'Converted' : 'Would convert'} ${converted} balance(s): ` +
      `₦${totalNgn.toLocaleString()} → $${(totalUsdMinor / 100).toFixed(2)}` +
      `${skipped ? ` (${skipped} already done)` : ''}`,
  );

  if (missingStores.length) {
    console.log(
      `\n${missingStores.length} vendor(s) have a balance but no Store — run ` +
        '`npm run backfill:stores -- --apply` first:\n  ' +
        missingStores.join('\n  '),
    );
  }

  console.log('\nVendorBalance rows are left intact — this conversion is reversible.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
