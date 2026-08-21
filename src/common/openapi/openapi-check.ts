import type { OpenAPIObject } from '@nestjs/swagger';
import { OPENAPI_OPERATION_ID_PATTERN } from './openapi.constants';

export interface OpenApiCheckFailure {
  message: string;
}

function collectOperationIds(document: OpenAPIObject): string[] {
  const httpMethods = [
    'get',
    'put',
    'post',
    'delete',
    'options',
    'head',
    'patch',
    'trace',
  ] as const;
  const ids: string[] = [];

  for (const pathItem of Object.values(document.paths ?? {})) {
    if (pathItem === undefined) {
      continue;
    }
    for (const method of httpMethods) {
      const operation = pathItem[method];
      const operationId = operation?.operationId;
      if (typeof operationId === 'string') {
        ids.push(operationId);
      }
    }
  }
  return ids;
}

export function assertOpenApiDocument(
  document: OpenAPIObject,
): OpenApiCheckFailure[] {
  const failures: OpenApiCheckFailure[] = [];

  if (document.openapi === undefined || document.openapi === '') {
    failures.push({ message: 'Missing OpenAPI version field.' });
  }
  if (document.info?.title !== 'EggShip API') {
    failures.push({ message: 'Unexpected OpenAPI title.' });
  }
  if (
    typeof document.info?.version !== 'string' ||
    document.info.version.trim() === ''
  ) {
    failures.push({ message: 'Missing OpenAPI info.version.' });
  }

  const healthPath = document.paths?.['/api/v1/health'];
  const healthGet = healthPath?.get;
  if (healthGet === undefined) {
    failures.push({
      message: 'Missing GET /api/v1/health in OpenAPI paths.',
    });
  } else if (healthGet.operationId !== 'Health_get') {
    failures.push({
      message: `Expected operationId Health_get, received ${String(healthGet.operationId)}.`,
    });
  }

  const requiredAuthOperations: Array<{
    path: string;
    method: 'get' | 'post';
    operationId: string;
  }> = [
    {
      path: '/api/v1/auth/otp/request',
      method: 'post',
      operationId: 'Auth_requestOtp',
    },
    {
      path: '/api/v1/auth/otp/verify',
      method: 'post',
      operationId: 'Auth_verifyOtp',
    },
    {
      path: '/api/v1/auth/refresh',
      method: 'post',
      operationId: 'Auth_refresh',
    },
    {
      path: '/api/v1/auth/logout',
      method: 'post',
      operationId: 'Auth_logout',
    },
    {
      path: '/api/v1/auth/logout-all',
      method: 'post',
      operationId: 'Auth_logoutAll',
    },
    {
      path: '/api/v1/admin/auth/login',
      method: 'post',
      operationId: 'AdminAuth_login',
    },
    {
      path: '/api/v1/admin/auth/me',
      method: 'get',
      operationId: 'AdminAuth_me',
    },
    {
      path: '/api/v1/admin/auth/refresh',
      method: 'post',
      operationId: 'AdminAuth_refresh',
    },
    {
      path: '/api/v1/admin/auth/logout',
      method: 'post',
      operationId: 'AdminAuth_logout',
    },
    {
      path: '/api/v1/admin/auth/logout-all',
      method: 'post',
      operationId: 'AdminAuth_logoutAll',
    },
  ];
  for (const required of requiredAuthOperations) {
    const operation = document.paths?.[required.path]?.[required.method];
    if (operation === undefined) {
      failures.push({
        message: `Missing ${required.method.toUpperCase()} ${required.path} in OpenAPI paths.`,
      });
    } else if (operation.operationId !== required.operationId) {
      failures.push({
        message: `Expected operationId ${required.operationId}, received ${String(operation.operationId)}.`,
      });
    }
  }

  const operationIds = collectOperationIds(document);
  const seen = new Set<string>();
  for (const operationId of operationIds) {
    if (!OPENAPI_OPERATION_ID_PATTERN.test(operationId)) {
      failures.push({
        message: `OperationId "${operationId}" does not match Tag_action convention.`,
      });
    }
    if (seen.has(operationId)) {
      failures.push({ message: `Duplicate operationId "${operationId}".` });
    }
    seen.add(operationId);
  }

  const serialized = JSON.stringify(document);
  const forbiddenFragments = [
    'postgresql://openapi.invalid',
    'REDIS_URL',
    'password=',
    'BEGIN PRIVATE KEY',
  ];
  for (const fragment of forbiddenFragments) {
    if (serialized.includes(fragment)) {
      failures.push({
        message: `OpenAPI document unexpectedly contains "${fragment}".`,
      });
    }
  }

  return failures;
}
