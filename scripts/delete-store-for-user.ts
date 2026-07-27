/**
 * Deletes one user's store so they can register again.
 *
 *   npx ts-node scripts/delete-store-for-user.ts --email=user@example.com          # dry run
 *   npx ts-node scripts/delete-store-for-user.ts --email=user@example.com --apply
 *
 * Prisma emulates the schema's onDelete: Cascade on Mongo, so deleting the
 * Store also removes its Subscription, StoreCreditEntry, Conversation and
 * store-scoped Review rows. Listings reference the store without a cascade,
 * so they are deleted explicitly here.
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');
const email = process.argv.find((a) => a.startsWith('--email='))?.split('=')[1];

async function main() {
  if (!email) throw new Error('Pass --email=<address>');

  const profile = await prisma.userProfile.findUnique({ where: { email } });
  if (!profile) {
    console.log(`No UserProfile found for ${email}`);
    return;
  }
  console.log(`User: ${profile.firstName} ${profile.lastName} <${profile.email}> userId=${profile.userId} role=${profile.role}`);

  const store = await prisma.store.findUnique({ where: { ownerId: profile.userId } });
  if (!store) {
    console.log('No store found for this user — nothing to delete.');
    return;
  }

  const [listings, subscription, creditEntries, conversations, reviews] = await Promise.all([
    prisma.product.count({ where: { storeId: store.id } }),
    prisma.subscription.findUnique({ where: { storeId: store.id } }),
    prisma.storeCreditEntry.count({ where: { storeId: store.id } }),
    prisma.conversation.count({ where: { storeId: store.id } }),
    prisma.review.count({ where: { storeId: store.id } }),
  ]);

  console.log(`Store: "${store.name}" (${store.slug}) id=${store.id} status=${store.status} creditMinor=${store.creditMinor}`);
  console.log(`  listings=${listings} subscription=${subscription?.status ?? 'none'} creditEntries=${creditEntries} conversations=${conversations} reviews=${reviews}`);

  if (!apply) {
    console.log('\nDry run — re-run with --apply to delete.');
    return;
  }

  const deletedListings = await prisma.product.deleteMany({ where: { storeId: store.id } });
  await prisma.store.delete({ where: { id: store.id } });
  console.log(`\nDeleted store ${store.id} and ${deletedListings.count} listing(s) (related rows cascaded).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
