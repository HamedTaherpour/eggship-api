import type { AcceptedMediaMimeType } from './accepted-media-types';

export const MediaAccessClass = {
  PUBLIC: 'PUBLIC',
  ADMIN_ONLY: 'ADMIN_ONLY',
} as const;
export type MediaAccessClass =
  (typeof MediaAccessClass)[keyof typeof MediaAccessClass];
export interface MediaReadTtlPolicy {
  publicDefault: number;
  publicMin: number;
  publicMax: number;
  adminDefault: number;
  adminMin: number;
  adminMax: number;
}

/**
 * Persistence-independent Media record. Binary content lives in object storage;
 * this is metadata only. `url` is derived at read time from storageKey + config.
 */
export interface MediaRecord {
  id: string;
  storageKey: string;
  originalFileName: string;
  mimeType: AcceptedMediaMimeType;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
  updatedAt: Date;
  accessClass: MediaAccessClass;
}

export interface CreateMediaInput {
  storageKey: string;
  originalFileName: string;
  mimeType: AcceptedMediaMimeType;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  accessClass?: MediaAccessClass;
}

export type MediaSortField = 'createdAt' | 'originalFileName' | 'sizeBytes';

export interface MediaListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: MediaSortField;
  sortOrder: 'asc' | 'desc';
  mimeType?: AcceptedMediaMimeType;
  createdFrom?: Date;
  createdTo?: Date;
}

/** Inbound multipart file after Nest/multer bounds. Domain does not import multer. */
export interface InboundMediaFile {
  originalName: string;
  claimedMimeType: string;
  size: number;
  buffer: Buffer;
}

export interface MediaUploadItemSuccess {
  index: number;
  status: 'uploaded';
  media: MediaRecord;
}

export interface MediaUploadItemFailure {
  index: number;
  status: 'failed';
  error: {
    code: string;
    message: string;
  };
}

export type MediaUploadItemResult =
  MediaUploadItemSuccess | MediaUploadItemFailure;

export interface MediaUploadSummary {
  total: number;
  uploaded: number;
  failed: number;
}

export interface MediaUploadBatchResult {
  items: MediaUploadItemResult[];
  summary: MediaUploadSummary;
}
