import type { Request } from 'express';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal';
import { AUTHENTICATED_PRINCIPAL_REQUEST_KEY } from './access-token.guard';

export function getAuthenticatedPrincipal(
  request: Request,
): AuthenticatedPrincipal | undefined {
  return (
    request as Request & {
      [AUTHENTICATED_PRINCIPAL_REQUEST_KEY]?: AuthenticatedPrincipal;
    }
  )[AUTHENTICATED_PRINCIPAL_REQUEST_KEY];
}
