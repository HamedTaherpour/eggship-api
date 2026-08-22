/**
 * Public Category list accepts no query parameters.
 *
 * An empty DTO keeps ValidationPipe `whitelist` + `forbidNonWhitelisted`
 * effective so pagination/search/filter/sort cannot be smuggled onto this
 * endpoint. Nest sets `forbidUnknownValues: false`, so an empty decorated
 * class remains valid when no query keys are present (same pattern as
 * `UpdateUserProfileBodyDto`).
 */
export class PublicCategoryListQueryDto {}
