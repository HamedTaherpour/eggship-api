import type { AcceptedMediaMimeType } from './accepted-media-types';
import {
  claimedTypeMatchesDetected,
  detectMediaMimeType,
} from './file-signature';
import { readImageDimensions, type ImageDimensions } from './image-dimensions';
import type { InboundMediaFile } from './media';
import {
  MediaFileTooLargeError,
  MediaUnsupportedTypeError,
} from './media-errors';
import { sanitizeOriginalFileName } from './original-file-name';

export interface ValidatedMediaFile {
  originalFileName: string;
  mimeType: AcceptedMediaMimeType;
  sizeBytes: number;
  buffer: Buffer;
  width: number | null;
  height: number | null;
}

export function validateInboundMediaFile(
  file: InboundMediaFile,
  maxFileBytes: number,
): ValidatedMediaFile {
  if (file.size > maxFileBytes || file.buffer.length > maxFileBytes) {
    throw new MediaFileTooLargeError();
  }
  if (file.buffer.length === 0 || file.size < 1) {
    throw new MediaUnsupportedTypeError('The file is empty.');
  }

  const detected = detectMediaMimeType(file.buffer);
  if (detected === undefined) {
    throw new MediaUnsupportedTypeError();
  }
  if (!claimedTypeMatchesDetected(file.claimedMimeType, detected)) {
    throw new MediaUnsupportedTypeError(
      'The file content does not match the declared type.',
    );
  }

  const dimensions: ImageDimensions | null = readImageDimensions(
    file.buffer,
    detected,
  );

  return {
    originalFileName: sanitizeOriginalFileName(file.originalName),
    mimeType: detected,
    sizeBytes: file.buffer.length,
    buffer: file.buffer,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}
