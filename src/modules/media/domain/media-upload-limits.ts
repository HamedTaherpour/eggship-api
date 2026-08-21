/**
 * Centralized Media upload bounds. Env may tighten or slightly raise these
 * within the hard maxima below; production must never run unbounded uploads.
 */
export const DEFAULT_MEDIA_MAX_FILE_BYTES = 5_242_880;
export const DEFAULT_MEDIA_MAX_FILES_PER_BATCH = 10;
export const DEFAULT_MEDIA_MAX_BATCH_BYTES = 26_214_400;
export const DEFAULT_MEDIA_UPLOAD_CONCURRENCY = 3;

export const HARD_MEDIA_MAX_FILE_BYTES = 20_971_520;
export const HARD_MEDIA_MAX_FILES_PER_BATCH = 20;
export const HARD_MEDIA_MAX_BATCH_BYTES = 104_857_600;
export const HARD_MEDIA_MAX_UPLOAD_CONCURRENCY = 8;

export interface MediaUploadLimits {
  maxFileBytes: number;
  maxFilesPerBatch: number;
  maxBatchBytes: number;
  uploadConcurrency: number;
}

export function assertMediaUploadLimits(
  limits: MediaUploadLimits,
): MediaUploadLimits {
  if (
    limits.maxFileBytes < 1 ||
    limits.maxFileBytes > HARD_MEDIA_MAX_FILE_BYTES
  ) {
    throw new Error(
      `MEDIA_MAX_FILE_BYTES must be between 1 and ${HARD_MEDIA_MAX_FILE_BYTES}.`,
    );
  }
  if (
    limits.maxFilesPerBatch < 1 ||
    limits.maxFilesPerBatch > HARD_MEDIA_MAX_FILES_PER_BATCH
  ) {
    throw new Error(
      `MEDIA_MAX_FILES_PER_BATCH must be between 1 and ${HARD_MEDIA_MAX_FILES_PER_BATCH}.`,
    );
  }
  if (
    limits.maxBatchBytes < 1 ||
    limits.maxBatchBytes > HARD_MEDIA_MAX_BATCH_BYTES
  ) {
    throw new Error(
      `MEDIA_MAX_BATCH_BYTES must be between 1 and ${HARD_MEDIA_MAX_BATCH_BYTES}.`,
    );
  }
  if (limits.maxBatchBytes < limits.maxFileBytes) {
    throw new Error(
      'MEDIA_MAX_BATCH_BYTES must be greater than or equal to MEDIA_MAX_FILE_BYTES.',
    );
  }
  if (
    limits.uploadConcurrency < 1 ||
    limits.uploadConcurrency > HARD_MEDIA_MAX_UPLOAD_CONCURRENCY
  ) {
    throw new Error(
      `MEDIA_UPLOAD_CONCURRENCY must be between 1 and ${HARD_MEDIA_MAX_UPLOAD_CONCURRENCY}.`,
    );
  }
  return limits;
}
