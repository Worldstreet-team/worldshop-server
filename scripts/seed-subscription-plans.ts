/**
 * Seeds the subscription plans. Additive and idempotent — safe to re-run, and
 * safe against the production database (it never deletes).
 *
 *   npm run seed:plans              # dry run
 *   npm run seed:plans -- --apply
 *
 * Amounts are USD minor units, matching the WorldStreet dollar wallet, which
 * already recognises `worldshop` as a spending platform. $20.00 = 2000.
 *
 * The free plan is not seeded by default. It exists as a deliberate lever: if
 * paid-only signup proves too steep at launch, seeding `free` lets stores
 * activate through the identical state machine at zero cost, with no code
 * change. Enable it with --with-free-tier.
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');
const withFreeTier = process.argv.includes('--with-free-tier');

const PLANS = [
  {
    code: 'standard',
    name: 'Standard',
    amountMinor: 2000, // $20.00
    currency: 'USD',
    intervalMonths: 1, // same date each month, not every 30 days
    intervalDays: 30, // fallback only; ignored while intervalMonths is set
    graceDays: 7,
    listingLimit: null as number | null,
    perks: [
      'Store visible in the marketplace',
      'Unlimited product listings',
      'Buyer messaging',
      'Store reviews and ratings',
      'Monthly inquiry analytics',
    ],
    sortOrder: 10,
  },
];

const FREE_PLAN = {
  code: 'free',
  name: 'Free',
  amountMinor: 0,
  currency: 'USD',
  intervalMonths: 1,
  intervalDays: 30,
  graceDays: 0,
  listingLimit: 5,
  perks: ['Store visible in the marketplace', 'Up to 5 listings', 'Buyer messaging'],
  sortOrder: 0,
};

async function main() {
  const plans = withFreeTier ? [FREE_PLAN, ...PLANS] : PLANS;

  console.log(apply ? 'APPLYING' : 'DRY RUN (re-run with --apply)', '\n');

  for (const plan of plans) {
    const existing = await prisma.subscriptionPlan.findUnique({ where: { code: plan.code } });
    const action = existing ? 'update' : 'create';
    const price = plan.amountMinor === 0 ? 'free' : `$${(plan.amountMinor / 100).toFixed(2)}`;

    const cycle = plan.intervalMonths ? `${plan.intervalMonths} month` : `${plan.intervalDays} days`;
    console.log(`  ${action.padEnd(6)} ${plan.code.padEnd(10)} ${price} / ${cycle}`);

    if (!apply) continue;

    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: plan,
      update: {
        name: plan.name,
        amountMinor: plan.amountMinor,
        intervalMonths: plan.intervalMonths,
        intervalDays: plan.intervalDays,
        graceDays: plan.graceDays,
        listingLimit: plan.listingLimit,
        perks: plan.perks,
        sortOrder: plan.sortOrder,
        isActive: true,
      },
    });
  }

  console.log(`\n${apply ? 'Seeded' : 'Would seed'} ${plans.length} plan(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
