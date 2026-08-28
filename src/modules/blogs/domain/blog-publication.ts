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

/**
 * Publish command semantics (CNT-02):
 * - First publish or republish after unpublish sets `publishedAt` to authoritative `now`.
 * - Replay on an already-published row is idempotent and preserves `publishedAt`.
 */
export function applyPublishTransition(
  current: BlogPublicationState,
  now: Date,
): Pick<BlogPublicationState, 'isPublished' | 'publishedAt'> {
  if (current.isPublished) {
    return {
      isPublished: true,
      publishedAt: current.publishedAt ?? now,
    };
  }

  return { isPublished: true, publishedAt: now };
}

/**
 * Unpublish command semantics (CNT-02):
 * - Sets `isPublished=false` while retaining the last `publishedAt` instant as history.
 * - Replay on an already-unpublished row is idempotent.
 */
export function applyUnpublishTransition(
  current: BlogPublicationState,
): Pick<BlogPublicationState, 'isPublished' | 'publishedAt'> {
  return {
    isPublished: false,
    publishedAt: current.publishedAt,
  };
}
