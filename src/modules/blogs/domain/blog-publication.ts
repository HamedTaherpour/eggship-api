/**
 * Canonical public-visibility predicate for Blog (CNT-01).
 *
 * A post is publicly eligible only when `isPublished` is true.
 * `publishedAt` is recorded evidence of publication (UTC timestamptz); it
 * is not compared to "now" and does not implement scheduled publishing.
 */

export interface BlogPublicationState {
  isPublished: boolean;
  publishedAt: Date | null;
}

/** Prisma/repository WHERE fragment shared by public list, detail, and counts. */
export function publishedBlogWhere(): { isPublished: true } {
  return { isPublished: true };
}

export function isBlogPubliclyVisible(
  blog: Pick<BlogPublicationState, 'isPublished'>,
): boolean {
  return blog.isPublished === true;
}

/**
 * Persistable publication fields. Published rows must have `publishedAt`.
 * Callers that omit `publishedAt` on publish receive `now`.
 */
export function resolveBlogPublication(input: {
  isPublished: boolean;
  publishedAt?: Date | null;
  now?: Date;
}): Pick<BlogPublicationState, 'isPublished' | 'publishedAt'> {
  if (!input.isPublished) {
    return { isPublished: false, publishedAt: input.publishedAt ?? null };
  }

  const publishedAt = input.publishedAt ?? input.now ?? new Date();
  return { isPublished: true, publishedAt };
}
