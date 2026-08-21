import { AuthError } from '../../modules/auth/domain/auth-error';
import { AuthErrorCode } from '../../modules/auth/domain/auth-error-codes';
import type { AuthenticatedPrincipal } from '../../modules/auth/domain/authenticated-principal';
import { AuthSubjectType } from '../../modules/auth/domain/subject-type';

/**
 * Derives the owner scope for a customer-owned resource from the authenticated
 * principal.
 *
 * This is the only approved source of an owner identifier. A request body,
 * query string, path parameter, or header must never select which customer's
 * data is read or written — that is the BOLA/IDOR boundary. Owner-scoped
 * queries should filter on this value together with the resource id (for
 * example `where: { id, userId }`) rather than loading by id and comparing
 * afterwards.
 *
 * An admin principal is rejected here on purpose: admin access to a customer
 * resource is a separate, permissioned capability, not the customer flow.
 *
 * Missing authentication and wrong subject type are answered differently, per
 * the approved contract in `instructions/authorization.md`: no principal is
 * `AUTH_UNAUTHENTICATED` (401), while an authenticated non-customer principal is
 * `AUTH_FORBIDDEN` (403). A browser client treats 401 as "refresh, then retry",
 * so answering 401 to a valid admin session would refresh successfully and retry
 * into a loop; 403 is terminal. The denial stays detail-free either way.
 */
export function requireCustomerOwnerId(
  principal: AuthenticatedPrincipal | undefined,
): string {
  if (principal === undefined) {
    throw new AuthError(
      AuthErrorCode.UNAUTHENTICATED,
      'Authentication required.',
    );
  }
  if (principal.subjectType !== AuthSubjectType.USER) {
    throw new AuthError(AuthErrorCode.FORBIDDEN, 'Insufficient permissions.');
  }
  return principal.subjectId;
}
