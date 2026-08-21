import { Readable } from 'node:stream';
import type { Request } from 'express';
import { MulterError } from 'multer';
import { MediaBatchTooLargeError } from '../domain/media-errors';
import { createBoundedMemoryStorage } from './bounded-memory-storage';

describe('createBoundedMemoryStorage', () => {
  it('assembles a file that stays within per-file and batch caps', async () => {
    const storage = createBoundedMemoryStorage({
      maxFileBytes: 16,
      maxBatchBytes: 32,
    });
    const result = await handleFile(
      storage,
      {} as Request,
      Readable.from([Buffer.from('hello')]),
    );
    expect(result.error).toBeUndefined();
    expect(result.buffer?.toString('utf8')).toBe('hello');
    expect(result.size).toBe(5);
  });

  it('aborts a single file that exceeds the per-file cap while reading', async () => {
    const storage = createBoundedMemoryStorage({
      maxFileBytes: 4,
      maxBatchBytes: 100,
    });
    const result = await handleFile(
      storage,
      {} as Request,
      Readable.from([Buffer.from('12345')]),
    );
    expect(result.error).toBeInstanceOf(MulterError);
    expect(result.error).toEqual(
      expect.objectContaining({ code: 'LIMIT_FILE_SIZE' }),
    );
  });

  it('aborts when cumulative batch bytes exceed the hard aggregate cap', async () => {
    const storage = createBoundedMemoryStorage({
      maxFileBytes: 20,
      maxBatchBytes: 10,
    });
    const req = {} as Request;
    const first = await handleFile(
      storage,
      req,
      Readable.from([Buffer.from('12345678')]),
    );
    expect(first.error).toBeUndefined();

    const second = await handleFile(
      storage,
      req,
      Readable.from([Buffer.from('12345678')]),
    );
    expect(second.error).toBeInstanceOf(MediaBatchTooLargeError);
  });
});

function handleFile(
  storage: ReturnType<typeof createBoundedMemoryStorage>,
  req: Request,
  stream: Readable,
): Promise<{ buffer?: Buffer; size?: number; error?: Error }> {
  return new Promise((resolve) => {
    const file = { stream } as Parameters<typeof storage._handleFile>[1];
    storage._handleFile(req, file, (error, info) => {
      if (error instanceof Error) {
        resolve({ error });
        return;
      }
      resolve({
        buffer: info?.buffer,
        size: info?.size,
      });
    });
  });
}
