import type { MediaRecord } from './media';

/** Safe consumer-facing Media representation. Storage keys never cross this boundary. */
export interface MediaPresentation {
  id: string;
  url: string;
}

export function toMediaPresentation(
  record: MediaRecord,
  url: string,
): MediaPresentation {
  return { id: record.id, url };
}
