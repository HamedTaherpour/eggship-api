import { assertDestructiveOperationsAllowed } from '../support/integration-environment';

/**
 * Truncates identity and Auth persistence tables for scoped integration cleanup.
 * Requires INTEGRATION_ALLOW_DESTRUCTIVE=true in addition to opt-in integration mode.
 */
export async function truncateAuthPersistenceTables(prisma: {
  $executeRawUnsafe: (query: string) => Promise<unknown>;
}): Promise<void> {
  assertDestructiveOperationsAllowed();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AdminAuthRefreshTokenConsumption", "AdminAuthSession", "AuthRefreshTokenConsumption", "AuthSession", "User", "Admin" RESTART IDENTITY CASCADE',
  );
}
