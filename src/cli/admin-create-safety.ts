/**
 * Safe DATABASE_URL identity for operator commands.
 * Never includes credentials, query strings, or the raw URL.
 */
export interface MaskedDatabaseTarget {
  protocol: string;
  host: string;
  port: string | undefined;
  database: string | undefined;
}

export function maskDatabaseUrl(databaseUrl: string): MaskedDatabaseTarget {
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(
      'DATABASE_URL must use the postgresql:// or postgres:// protocol.',
    );
  }
  if (url.hostname === '') {
    throw new Error('DATABASE_URL is missing a host.');
  }
  const database = url.pathname.replace(/^\//u, '');
  return {
    protocol: url.protocol.replace(/:$/u, ''),
    host: url.hostname,
    port: url.port === '' ? undefined : url.port,
    database: database === '' ? undefined : database,
  };
}

export function formatMaskedDatabaseTarget(
  target: MaskedDatabaseTarget,
): string {
  const port = target.port === undefined ? '' : `:${target.port}`;
  const database = target.database === undefined ? '' : `/${target.database}`;
  return `${target.protocol}://${target.host}${port}${database}`;
}

export type AdminCreateNodeEnv = 'development' | 'test' | 'production';

export function parseAdminCreateNodeEnv(
  value: string | undefined,
): AdminCreateNodeEnv {
  if (value === 'development' || value === 'test' || value === 'production') {
    return value;
  }
  throw new Error('NODE_ENV must be development, test, or production.');
}

/**
 * Non-development environments require an explicit confirmation token.
 * Hostnames are never used to guess production.
 */
export function assertAdminCreateConfirmation(input: {
  nodeEnv: AdminCreateNodeEnv;
  confirm: string | undefined;
  databaseHost: string;
}): void {
  if (input.nodeEnv === 'development' || input.nodeEnv === 'test') {
    if (input.confirm !== 'yes') {
      throw new Error(
        'Non-interactive Admin creation requires EGGSHIP_ADMIN_CREATE_CONFIRM=yes in development/test.',
      );
    }
    return;
  }

  const expected = `I_UNDERSTAND_PRODUCTION:${input.databaseHost}`;
  if (input.confirm !== expected) {
    throw new Error(
      `Production Admin creation requires EGGSHIP_ADMIN_CREATE_CONFIRM=${expected}`,
    );
  }
}
