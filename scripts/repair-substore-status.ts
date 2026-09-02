/**
 * Repairs substores whose status disagrees with their mall's visibility.
 *
 *   npm run repair:substore-status              # dry run
 *   npm run repair:substore-status -- --apply
 *
 * Why this exists: a store's status is stamped at creation from its mall's
 * visibility, then only ever rewritten by the mall's billing transitions. Any
 * change to a mall's visibility that is NOT a billing transition leaves its
 * stores on the old rule — hidden from the public mall page (or wrongly shown
 * on it), with no owner action able to correct them. The MALL_PAYWALL flag did
 * exactly that, in both directions, while it existed.
 *
 * The server also runs this reconciliation at boot and on every renewal sweep;
 * this script is the same call, for repairing production without a deploy.
 * Idempotent — a second run finds nothing.
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';
import { reconcileSubstoreStatuses } from '../src/services/mall.service';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');

async function main() {
  console.log(apply ? 'APPLYING' : 'DRY RUN (re-run with --apply)', '\n');

  const { revealed, hidden } = await reconcileSubstoreStatuses({ dryRun: !apply });

  const verb = apply ? '' : 'Would ';
  console.log(`  ${verb}${apply ? 'Revealed' : 'reveal'} ${revealed} substore(s): EXPIRED → ACTIVE (mall is visible)`);
  console.log(`  ${verb}${apply ? 'Hid' : 'hide'} ${hidden} substore(s): ACTIVE/GRACE → EXPIRED (mall is not visible)`);

  if (!apply && (revealed || hidden)) {
    console.log('\nRe-run with --apply to write these changes.');
  }
  if (!revealed && !hidden) {
    console.log('\nNothing to repair — substore statuses already agree with their malls.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
