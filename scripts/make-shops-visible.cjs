// One-off: make two shops visible. Run from the worldshop-server folder:
//   node scripts/make-shops-visible.cjs
// Prints every row before and after, and stops without writing if a shop's
// owner email does not match.
//
// Jasmin & Sons: ACTIVE for a year, autoRenew off, so the renewal sweep never
// bills the owner (it only charges autoRenew subscriptions) and never hides the
// shop (it only acts on GRACE and CANCELLED).
//
// Monogenes Opulence: GRACE until GRACE_DAYS from now, then the sweep hides it
// (EXPIRED) unless she pays. CHARGE_DURING_GRACE=true lets the sweep try her
// wallet every hour during grace; false means it just runs out, no charges.
require('dotenv').config();
const { PrismaClient } = require('../generated/prisma');

const GRACE_DAYS = 7;
const CHARGE_DURING_GRACE = false;

const SHOPS = [
  { slug: 'jasmin-sons', email: 'jboyi242@uniport.edu.ng', mode: 'active' },
  { slug: 'opulent-lux', email: 'zoeenabs3@gmail.com', mode: 'grace' },
];

(async () => {
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const yearOn = new Date(now);
    yearOn.setFullYear(yearOn.getFullYear() + 1);
    const graceEnds = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);

    // Check both before writing either.
    const found = [];
    for (const shop of SHOPS) {
      const s = await prisma.store.findUnique({
        where: { slug: shop.slug },
        select: {
          id: true, slug: true, email: true, status: true,
          subscription: { select: { id: true, status: true, autoRenew: true, currentPeriodStart: true, currentPeriodEnd: true, graceEndsAt: true, cancelledAt: true } },
        },
      });
      if (!s || s.email !== shop.email || !s.subscription) {
        throw new Error(`Stopped, nothing written: ${shop.slug} not found, owner email differs, or no subscription. Got ${JSON.stringify(s)}`);
      }
      found.push({ shop, s });
    }

    for (const { shop, s } of found) {
      console.log('BEFORE', JSON.stringify(s));
      const sub =
        shop.mode === 'active'
          ? { status: 'ACTIVE', autoRenew: false, currentPeriodStart: now, currentPeriodEnd: yearOn, graceEndsAt: null, cancelledAt: null }
          : { status: 'GRACE', autoRenew: CHARGE_DURING_GRACE, graceEndsAt: graceEnds, cancelledAt: null };
      await prisma.$transaction([
        prisma.store.update({ where: { id: s.id }, data: { status: shop.mode === 'active' ? 'ACTIVE' : 'GRACE' } }),
        prisma.subscription.update({ where: { id: s.subscription.id }, data: sub }),
      ]);
      const after = await prisma.store.findUnique({
        where: { id: s.id },
        select: { slug: true, status: true, subscription: { select: { status: true, autoRenew: true, currentPeriodEnd: true, graceEndsAt: true } } },
      });
      console.log('AFTER ', JSON.stringify(after));
    }
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
