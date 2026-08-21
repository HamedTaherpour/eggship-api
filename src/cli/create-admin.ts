import { NestFactory } from '@nestjs/core';
import { redactSensitiveText } from '../common/observability/log-redaction';
import { NestLoggerAdapter } from '../common/observability/nest-logger.adapter';
import { AdminIdentityService } from '../modules/admins/application/admin-identity.service';
import { AdminEmailAlreadyExistsError } from '../modules/admins/domain/admin-errors';
import { AdminCreateCliModule } from './admin-create.module';
import { parseAdminCreateInput } from './admin-create-input';
import {
  assertAdminCreateConfirmation,
  formatMaskedDatabaseTarget,
  maskDatabaseUrl,
  parseAdminCreateNodeEnv,
} from './admin-create-safety';

/**
 * Operator-controlled Admin provisioning. Never invoked from HTTP or app bootstrap.
 *
 * Input comes from explicit env vars collected by `pnpm admin:create` / the
 * wrapper script. The password is never printed after creation.
 */
async function main(): Promise<void> {
  const nodeEnv = parseAdminCreateNodeEnv(process.env['NODE_ENV']);
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error(
      'DATABASE_URL is required so the target database is explicit.',
    );
  }

  const target = maskDatabaseUrl(databaseUrl);
  process.stderr.write(
    `Admin create target: ${formatMaskedDatabaseTarget(target)}\n`,
  );

  assertAdminCreateConfirmation({
    nodeEnv,
    confirm: process.env['EGGSHIP_ADMIN_CREATE_CONFIRM'],
    databaseHost: target.host,
  });

  const input = parseAdminCreateInput({
    email: process.env['EGGSHIP_ADMIN_CREATE_EMAIL'],
    password: process.env['EGGSHIP_ADMIN_CREATE_PASSWORD'],
    role: process.env['EGGSHIP_ADMIN_CREATE_ROLE'],
  });

  const app = await NestFactory.createApplicationContext(AdminCreateCliModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(NestLoggerAdapter));

  try {
    const identity = app.get(AdminIdentityService);
    const admin = await identity.createAdmin({
      email: input.email,
      password: input.password,
      role: input.role,
    });
    process.stdout.write(`Admin created id=${admin.id} role=${admin.role}\n`);
  } catch (error: unknown) {
    if (error instanceof AdminEmailAlreadyExistsError) {
      throw new Error('An admin with this email already exists.', {
        cause: error,
      });
    }
    throw error;
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const raw = error instanceof Error ? error.message : 'Admin create failed.';
  process.stderr.write(`${redactSensitiveText(raw)}\n`);
  process.exitCode = 1;
});
