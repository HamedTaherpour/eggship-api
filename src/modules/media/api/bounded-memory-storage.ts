import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import { MulterError } from 'multer';
import { MediaBatchTooLargeError } from '../domain/media-errors';

const batchBytesByRequest = new WeakMap<object, number>();

export interface BoundedMemoryStorageOptions {
  maxFileBytes: number;
  maxBatchBytes: number;
}

/**
 * In-memory multer storage that aborts while reading, so a batch cannot
 * buffer past the hard aggregate cap. Must not be used as production object
 * storage; it only holds the inbound multipart payload.
 */
export function createBoundedMemoryStorage(
  options: BoundedMemoryStorageOptions,
): StorageEngine {
  return {
    _handleFile(req: Request, file, callback): void {
      const chunks: Buffer[] = [];
      let fileBytes = 0;
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        file.stream.removeAllListeners();
        if (!file.stream.destroyed) {
          file.stream.destroy();
        }
        callback(error);
      };

      file.stream.on('data', (chunk: Buffer | string) => {
        if (settled) {
          return;
        }
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        fileBytes += bytes.length;
        const batchBytes = (batchBytesByRequest.get(req) ?? 0) + bytes.length;
        batchBytesByRequest.set(req, batchBytes);

        if (fileBytes > options.maxFileBytes) {
          fail(new MulterError('LIMIT_FILE_SIZE'));
          return;
        }
        if (batchBytes > options.maxBatchBytes) {
          fail(new MediaBatchTooLargeError());
          return;
        }
        chunks.push(bytes);
      });

      file.stream.on('error', (error: Error) => {
        fail(error);
      });

      file.stream.on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        callback(null, {
          buffer: Buffer.concat(chunks, fileBytes),
          size: fileBytes,
        });
      });
    },

    _removeFile(_req, file, callback): void {
      file.buffer = Buffer.alloc(0);
      callback(null);
    },
  };
}
