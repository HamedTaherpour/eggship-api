/**
 * Blog text invariants shared by domain normalization and PostgreSQL CHECKs.
 *
 * Application trimming uses ECMAScript String.trim() (all Unicode whitespace).
 * Database CHECKs trim only ASCII space, tab, LF, and CR - a deliberate,
 * supportable subset documented in the blog_content migration. Repository writes
 * always normalize through domain helpers first; the DB guard blocks obvious
 * whitespace-only bypasses for that subset on direct SQL paths.
 */

/** Matches PostgreSQL char_length (Unicode code points, not UTF-16 units). */
export function blogTextCharLength(value: string): number {
  return Array.from(value).length;
}
