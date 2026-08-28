import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  Controller,
  Get,
  Module,
  Post,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Test as SupertestTest } from 'supertest';
import { configureApplication } from '../src/app.setup';
import { AdminRole } from '../src/common/authz/admin-role';
import type {
  AdminAuthorizationLookup,
  AdminRoleResolver,
} from '../src/common/authz/admin-role-resolver';
import { AuthorizationModule } from '../src/common/authz/authorization.module';
import { ADMIN_ROLE_RESOLVER } from '../src/common/authz/authorization.tokens';
import { Permission } from '../src/common/authz/permission';
import { PermissionGuard } from '../src/common/authz/permission.guard';
import {
  REQUIRED_PERMISSIONS_METADATA_KEY,
  RequirePermissions,
} from '../src/common/authz/require-permissions.decorator';
import { LOG_DESTINATION } from '../src/common/observability/application-logger.service';
import { ObservabilityModule } from '../src/common/observability/observability.module';
import { createConfigModuleOptions } from '../src/config/config-module.options';
import { AccessTokenGuard } from '../src/modules/auth/api/access-token.guard';
import { CsrfGuard } from '../src/modules/auth/api/csrf.guard';
import { CsrfService } from '../src/modules/auth/api/csrf.service';
import { AuthSubjectType } from '../src/modules/auth/domain/subject-type';
import { AccessTokenService } from '../src/modules/auth/infrastructure/access-token.service';

interface ProbeResponse {
  readonly data: { readonly ok: true };
}

/**
 * Test-only routes. AUTH-08 introduces no production admin endpoints, so the
 * authorization boundary is exercised through a probe controller that exists
 * only in this suite and never reaches `src/` or the OpenAPI document.
 */
@Controller('internal-test/authz')
@UseGuards(AccessTokenGuard, PermissionGuard)
class AuthorizationProbeController {
  @Get('inventory')
  @RequirePermissions(Permission.INVENTORY_READ)
  readInventory(): ProbeResponse {
    return { data: { ok: true } };
  }

  @Post('inventory/adjustments')
  @RequirePermissions(Permission.INVENTORY_READ, Permission.INVENTORY_ADJUST)
  adjustInventory(): ProbeResponse {
    return { data: { ok: true } };
  }

  @Post('orders/transitions')
  @RequirePermissions(Permission.ORDER_TRANSITION)
  transitionOrder(): ProbeResponse {
    return { data: { ok: true } };
  }

  @Get('admins')
  @RequirePermissions(Permission.ADMIN_READ)
  listAdmins(): ProbeResponse {
    return { data: { ok: true } };
  }

  /** Wiring defect: guarded but declares no permission. Must fail closed. */
  @Get('undeclared')
  undeclared(): ProbeResponse {
    return { data: { ok: true } };
  }

  /**
   * Wiring defect: declares a permission outside the catalog, as a stale or
   * hand-written identifier would. Written as raw metadata because that is how
   * such a value actually arrives — through untyped reflection.
   */
  @Get('unknown-permission')
  @SetMetadata(REQUIRED_PERMISSIONS_METADATA_KEY, ['INVENTORY_DESTROY'])
  unknownPermission(): ProbeResponse {
    return { data: { ok: true } };
  }
}

/**
 * Stands in for a future admin feature module. It deliberately does **not**
 * import `AuthorizationModule`: a feature module must be able to use
 * `PermissionGuard` and `AuthorizationService` without importing or
 * re-registering authorization, which is what makes the module global.
 */
@Module({
  controllers: [AuthorizationProbeController],
  providers: [AccessTokenService, AccessTokenGuard, CsrfService, CsrfGuard],
})
class ProbeFeatureModule {}

class ConfigurableAdminRoleResolver implements AdminRoleResolver {
  private lookup: AdminAuthorizationLookup = { status: 'unavailable' };
  private failure: Error | undefined;
  private echoRequestedId = true;

  findAdminAuthorization(adminId: string): Promise<AdminAuthorizationLookup> {
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    // A correct resolver answers for the admin it was asked about.
    return Promise.resolve(
      this.lookup.status === 'found' && this.echoRequestedId
        ? { status: 'found', record: { ...this.lookup.record, adminId } }
        : this.lookup,
    );
  }

  setLookup(lookup: AdminAuthorizationLookup): void {
    this.lookup = lookup;
    this.failure = undefined;
    this.echoRequestedId = true;
  }

  activeRole(role: string): void {
    this.setLookup({
      status: 'found',
      record: { adminId: 'replaced-with-requested-id', role, isActive: true },
    });
  }

  /** Simulates a resolver that answers about a different admin. */
  answerForOtherAdmin(role: string): void {
    this.setLookup({
      status: 'found',
      record: { adminId: 'a-different-admin', role, isActive: true },
    });
    this.echoRequestedId = false;
  }

  failWith(error: Error): void {
    this.failure = error;
  }
}

class LogSink {
  readonly lines: string[] = [];

  write(chunk: string): void {
    this.lines.push(chunk);
  }

  clear(): void {
    this.lines.length = 0;
  }

  events(operation: string): Record<string, unknown>[] {
    return this.lines
      .map((line): unknown => JSON.parse(line) as unknown)
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as Record<string, unknown>)['operation'] === operation,
      );
  }
}

/**
 * Signs a valid access token directly so permission probes do not depend on
 * Admin login. Production `AccessTokenService` now issues ADMIN tokens when a
 * real AdminAuthSession exists; this suite still mints tokens locally.
 */
function signAccessToken(subjectType: AuthSubjectType): string {
  return jwt.sign(
    {
      sub: randomUUID(),
      subjectType,
      sessionId: randomUUID(),
      tokenUse: 'access',
    },
    process.env['JWT_ACCESS_SECRET'] ?? '',
    { algorithm: 'HS256', expiresIn: 900 },
  );
}

describe('authorization guard boundary (e2e)', () => {
  let app: INestApplication;
  let admins: ConfigurableAdminRoleResolver;
  let logs: LogSink;

  beforeAll(async () => {
    admins = new ConfigurableAdminRoleResolver();
    logs = new LogSink();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(createConfigModuleOptions()),
        ObservabilityModule,
        AuthorizationModule.forRoot(),
        ProbeFeatureModule,
      ],
    })
      .overrideProvider(ADMIN_ROLE_RESOLVER)
      .useValue(admins)
      .overrideProvider(LOG_DESTINATION)
      .useValue(logs)
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    logs.clear();
    admins.setLookup({ status: 'unavailable' });
  });

  function get(path: string, token?: string): SupertestTest {
    const call = request(app.getHttpServer() as Server).get(
      `/api/v1/internal-test/authz/${path}`,
    );
    return token === undefined
      ? call
      : call.set('Authorization', `Bearer ${token}`);
  }

  function post(path: string, token?: string): SupertestTest {
    const call = request(app.getHttpServer() as Server).post(
      `/api/v1/internal-test/authz/${path}`,
    );
    return token === undefined
      ? call
      : call.set('Authorization', `Bearer ${token}`);
  }

  it('resolves the guard in a feature module that never imports authorization', async () => {
    // Regression guard: the whole suite runs against a controller declared in
    // ProbeFeatureModule, so booting at all proves PermissionGuard and
    // AuthorizationService resolve globally. If registration stopped being
    // global, app.init() in beforeAll would fail to resolve AuthorizationService.
    admins.activeRole(AdminRole.WAREHOUSE);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    await get('inventory', token).expect(200);
  });

  it('rejects an unauthenticated request with 401 AUTH_UNAUTHENTICATED', async () => {
    const response = await get('inventory').expect(401);

    expect(response.body).toMatchObject({
      error: { code: 'AUTH_UNAUTHENTICATED' },
    });
    expect(response.headers['x-request-id']).toMatch(/^req_/u);
  });

  it('rejects an invalid access token before authorization runs', async () => {
    admins.activeRole(AdminRole.SUPER_ADMIN);

    const response = await get('inventory', 'not-a-jwt').expect(401);

    expect(response.body).toMatchObject({
      error: { code: 'AUTH_INVALID_TOKEN' },
    });
    expect(logs.events('authz.denied')).toEqual([]);
  });

  it('rejects an authenticated customer with 403 and no policy detail', async () => {
    admins.activeRole(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.USER);

    const response = await get('inventory', token).expect(403);

    expect(response.body).toMatchObject({
      error: {
        code: 'AUTH_FORBIDDEN',
        message: 'Insufficient permissions.',
        details: {},
      },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/INVENTORY/u);
    expect(JSON.stringify(response.body)).not.toMatch(/SUPER_ADMIN/u);
  });

  it('allows an admin whose role grants the required permission', async () => {
    admins.activeRole(AdminRole.WAREHOUSE);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    await get('inventory', token)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({ data: { ok: true } });
      });
  });

  it('applies ALL semantics for multi-permission routes', async () => {
    const token = signAccessToken(AuthSubjectType.ADMIN);

    admins.activeRole(AdminRole.WAREHOUSE);
    await post('inventory/adjustments', token).expect(201);

    admins.activeRole(AdminRole.ORDER_OPS);
    await post('inventory/adjustments', token).expect(403);
  });

  it('keeps WAREHOUSE out of order transitions and admin management', async () => {
    admins.activeRole(AdminRole.WAREHOUSE);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    const transition = await post('orders/transitions', token).expect(403);
    const admins403 = await get('admins', token).expect(403);

    for (const response of [transition, admins403]) {
      expect(response.body).toMatchObject({
        error: {
          code: 'AUTH_FORBIDDEN',
          message: 'Insufficient permissions.',
          details: {},
        },
      });
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toMatch(/WAREHOUSE/u);
      expect(serialized).not.toMatch(/ORDER_TRANSITION|ADMIN_READ/u);
      expect(serialized).not.toMatch(/missing_permission/u);
    }
  });

  it('keeps ORDER_OPS out of inventory adjustment and admin management', async () => {
    admins.activeRole(AdminRole.ORDER_OPS);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    await post('orders/transitions', token).expect(201);
    await post('inventory/adjustments', token).expect(403);
    await get('admins', token).expect(403);
  });

  it('allows SUPER_ADMIN the approved admin operations', async () => {
    admins.activeRole(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    await get('inventory', token).expect(200);
    await post('inventory/adjustments', token).expect(201);
    await post('orders/transitions', token).expect(201);
    await get('admins', token).expect(200);
  });

  it('denies an inactive admin, an unknown role, and a missing admin record', async () => {
    const token = signAccessToken(AuthSubjectType.ADMIN);

    admins.setLookup({
      status: 'found',
      record: {
        adminId: 'probe-admin',
        role: AdminRole.SUPER_ADMIN,
        isActive: false,
      },
    });
    await get('inventory', token).expect(403);

    admins.activeRole('ROOT');
    await get('inventory', token).expect(403);

    admins.setLookup({ status: 'not_found' });
    await get('inventory', token).expect(403);
  });

  it('denies admin routes while Admin identity persistence is unavailable', async () => {
    const token = signAccessToken(AuthSubjectType.ADMIN);

    await get('inventory', token).expect(403);

    expect(logs.events('authz.denied')[0]).toMatchObject({
      module: 'authz',
      reason: 'admin_directory_unavailable',
      subjectType: AuthSubjectType.ADMIN,
    });
  });

  it('denies with 403 when the admin directory throws, without surfacing a 500', async () => {
    const token = signAccessToken(AuthSubjectType.ADMIN);
    admins.failWith(new Error('connection terminated unexpectedly'));

    const response = await get('inventory', token).expect(403);

    expect(response.body).toMatchObject({
      error: { code: 'AUTH_FORBIDDEN', message: 'Insufficient permissions.' },
    });
    expect(logs.events('authz.admin_lookup_failed')[0]).toMatchObject({
      level: 'error',
      module: 'authz',
    });
    expect(logs.events('authz.denied')[0]).toMatchObject({
      reason: 'admin_directory_unavailable',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/connection terminated/u);
  });

  it('denies when the directory answers about a different admin', async () => {
    admins.answerForOtherAdmin(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    await get('inventory', token).expect(403);

    expect(logs.events('authz.denied')[0]).toMatchObject({
      reason: 'admin_identity_mismatch',
    });
  });

  it('fails closed on a guarded route that declares no permission', async () => {
    admins.activeRole(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    const response = await get('undeclared', token).expect(403);

    expect(response.body).toMatchObject({
      error: { code: 'AUTH_FORBIDDEN', message: 'Insufficient permissions.' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/no_permissions/u);
    expect(logs.events('authz.denied')[0]).toMatchObject({
      level: 'error',
      reason: 'no_permissions_requested',
    });
  });

  it('fails closed on a route declaring a permission outside the catalog', async () => {
    admins.activeRole(AdminRole.SUPER_ADMIN);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    const response = await get('unknown-permission', token).expect(403);

    expect(JSON.stringify(response.body)).not.toMatch(/INVENTORY_DESTROY/u);
    expect(logs.events('authz.denied')[0]).toMatchObject({
      level: 'error',
      reason: 'unknown_permission_requested',
    });
  });

  it('answers 401 on a misconfigured route so it cannot be fingerprinted anonymously', async () => {
    await get('undeclared').expect(401);
    await get('unknown-permission').expect(401);

    expect(logs.events('authz.denied')).toEqual([]);
  });

  it('logs denials without token, cookie, or authorization material', async () => {
    admins.activeRole(AdminRole.ORDER_OPS);
    const token = signAccessToken(AuthSubjectType.ADMIN);

    await post('inventory/adjustments', token).expect(403);

    const denials = logs.events('authz.denied');
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({
      reason: 'missing_permission',
      requiredPermissions: [
        Permission.INVENTORY_READ,
        Permission.INVENTORY_ADJUST,
      ],
    });
    const serialized = logs.lines.join('\n');
    expect(serialized).not.toContain(token);
    expect(serialized).not.toMatch(/eggship_at=/u);
  });
});
