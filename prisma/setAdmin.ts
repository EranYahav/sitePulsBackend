/**
 * One-off / idempotent: promote a user to app administrator by email.
 *
 *   npx ts-node-dev --transpile-only prisma/setAdmin.ts [email]
 *
 * Defaults to yahaveran@gmail.com. Safe to run repeatedly. Reports clearly if
 * the email isn't registered yet (a flag on a non-existent row is a no-op).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const email = (process.argv[2] ?? "yahaveran@gmail.com").trim().toLowerCase();

async function main() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(
      `\n✖ No user with email "${email}" exists yet.\n` +
        `  Register/sign up with that email first, then re-run this script.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const updated = await prisma.user.update({
    where: { email },
    data: { isAdmin: true },
    select: { id: true, email: true, name: true, isAdmin: true, tier: true },
  });

  console.log(`\n✔ ${updated.email} is now an app admin (isAdmin=true, tier=${updated.tier}).\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
