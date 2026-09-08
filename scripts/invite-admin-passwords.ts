/**
 * Mails a password setup link to every admin who has not set one yet.
 *
 *   npm run invite:admins            # dry run — lists who would be mailed
 *   npm run invite:admins -- --apply
 *
 * Not required for correctness: an admin with no password is mailed the same
 * link the first time they try to sign in. This is for rollout, so nobody has
 * to discover the new console by failing to log into it.
 *
 * Safe to re-run. Each run supersedes that admin's previous unused link, so the
 * newest email is always the one that works.
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';
import { issueSetupToken } from '../src/services/auth.service';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');

async function main() {
  const admins = await prisma.userProfile.findMany({
    where: { role: 'ADMIN', passwordHash: null },
    select: { userId: true, email: true, firstName: true },
    orderBy: { createdAt: 'asc' },
  });

  if (admins.length === 0) {
    console.log('Every admin already has a password. Nothing to send.');
    return;
  }

  console.log(`${admins.length} admin(s) without a password:`);
  admins.forEach((a) => console.log(`  - ${a.email}`));

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to send the setup links.');
    return;
  }

  let sent = 0;
  for (const admin of admins) {
    try {
      await issueSetupToken(admin.userId, admin.email, admin.firstName);
      console.log(`  ✓ sent to ${admin.email}`);
      sent += 1;
    } catch (err) {
      console.error(`  ✗ ${admin.email}: ${(err as Error)?.message}`);
    }
  }

  console.log(`\nSent ${sent}/${admins.length} setup link(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
