/**
 * Recomputes every store's reply time and response rate with the current
 * rule (the median first reply; see recomputeStoreResponseMetrics). Stored
 * values only refresh when a seller next replies, so after a rule change the
 * old figures stay on store cards until this runs.
 *
 *   npm run recompute:response-times             # dry run: shows the changes
 *   npm run recompute:response-times -- --apply
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';
import { recomputeStoreResponseMetrics } from '../src/services/chat.service';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');

const days = (mins: number | null) => (mins == null ? '—' : `${(mins / 1440).toFixed(1)} days`);

async function main() {
  const stores = await prisma.store.findMany({ select: { id: true, name: true, avgResponseMins: true } });
  console.log(`${stores.length} stores. ${apply ? 'Applying.' : 'Dry run: nothing is written. Pass --apply to write.'}`);

  for (const store of stores) {
    if (!apply) {
      // Same arithmetic as the service, without the write.
      const threads = await prisma.conversation.findMany({
        where: { storeId: store.id, vendorFirstReplyAt: { not: null } },
        select: { createdAt: true, vendorFirstReplyAt: true },
      });
      const delays = threads
        .map((t) => (t.vendorFirstReplyAt!.getTime() - t.createdAt.getTime()) / 60_000)
        .sort((a, b) => a - b);
      const mid = Math.floor(delays.length / 2);
      const next = delays.length
        ? Math.round(delays.length % 2 ? delays[mid] : (delays[mid - 1] + delays[mid]) / 2)
        : null;
      if (next !== store.avgResponseMins) {
        console.log(`  ${store.name}: ${days(store.avgResponseMins)} -> ${days(next)}`);
      }
      continue;
    }
    const { avgResponseMins } = await recomputeStoreResponseMetrics(store.id);
    if (avgResponseMins !== store.avgResponseMins) {
      console.log(`  ${store.name}: ${days(store.avgResponseMins)} -> ${days(avgResponseMins)}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
