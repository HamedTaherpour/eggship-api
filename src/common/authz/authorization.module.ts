import { Module } from '@nestjs/common';
import type { DynamicModule, ModuleMetadata, Provider } from '@nestjs/common';
import { AdminPersistenceUnavailableRoleResolver } from './admin-persistence-unavailable.resolver';
import { ADMIN_ROLE_RESOLVER } from './authorization.tokens';
import { AuthorizationService } from './authorization.service';
import { PermissionGuard } from './permission.guard';

/** Call `forRoot` exactly once, from the composition root. */
export interface AuthorizationModuleOptions {
  /** Modules that expose the provider supplying `ADMIN_ROLE_RESOLVER`. */
  readonly imports?: NonNullable<ModuleMetadata['imports']>;
  /**
   * Binding for `ADMIN_ROLE_RESOLVER`. Omit it to keep the fail-closed default
   * that reports the admin directory as unavailable.
   */
  readonly adminRoleResolver?: Provider;
}

/**
 * Cross-cutting authorization infrastructure: the permission catalog, role
 * policy, resolution service, and route guard.
 *
 * It imports no business Nest module, so feature modules can require
 * permissions without Auth or Admin modules importing them back. At source
 * level it does depend on Auth's published principal contract
 * (`AuthenticatedPrincipal`, `AuthSubjectType`, `AuthError`, and the request
 * accessor); see `instructions/authorization.md` for why that is accepted and
 * what would need to move if Auth ever needs authorization itself. Admin identity lives
 * outside this module: the owning module supplies an `AdminRoleResolver` through
 * `forRoot`, which is why this is a dynamic module rather than a static one —
 * a static binding could only be replaced by importing the Admin module here,
 * creating exactly the cycle the placement is meant to avoid.
 *
 * `ADMIN_ROLE_RESOLVER` is intentionally not exported: consumers authorize
 * through `AuthorizationService`, never by reading raw role or activation state.
 */
@Module({})
export class AuthorizationModule {
  static forRoot(options: AuthorizationModuleOptions = {}): DynamicModule {
    const adminRoleResolver: Provider = options.adminRoleResolver ?? {
      provide: ADMIN_ROLE_RESOLVER,
      useClass: AdminPersistenceUnavailableRoleResolver,
    };

    return {
      module: AuthorizationModule,
      // Global for the same reason ObservabilityModule is: this is cross-cutting
      // infrastructure registered exactly once at the composition root. It also
      // removes a footgun — a feature module writing `imports:
      // [AuthorizationModule]` would instantiate the bare class with no
      // providers, and calling `forRoot()` a second time would build a second
      // AuthorizationService still bound to the fail-closed default resolver,
      // silently denying that module's admin routes after ADM-01 lands.
      global: true,
      imports: options.imports ?? [],
      providers: [adminRoleResolver, AuthorizationService, PermissionGuard],
      exports: [AuthorizationService, PermissionGuard],
    };
  }
}
