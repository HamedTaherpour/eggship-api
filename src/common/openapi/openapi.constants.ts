export const OPENAPI_UI_PATH = 'docs';
export const OPENAPI_JSON_PATH = 'docs-json';
export const OPENAPI_ARTIFACT_PATH = 'artifacts/openapi.json';

/**
 * Deterministic operationId convention: `{Tag}_{action}`.
 * Examples: Health_get, Orders_list, Orders_create.
 * Prefer an explicit @ApiOperation({ operationId }) over Nest defaults.
 */
export const OPENAPI_OPERATION_ID_PATTERN =
  /^[A-Za-z][A-Za-z0-9]*_[a-z][A-Za-z0-9]*$/u;
