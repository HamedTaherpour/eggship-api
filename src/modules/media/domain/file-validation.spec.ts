import {
  detectMediaMimeType,
  claimedTypeMatchesDetected,
} from './file-signature';
import { validateInboundMediaFile } from './file-validation';
import { readImageDimensions } from './image-dimensions';
import {
  MediaFileTooLargeError,
  MediaUnsupportedTypeError,
} from './media-errors';
import {
  jpegFixture,
  pngFixture,
  svgFixture,
  webpFixture,
  gifFixture,
} from './media-test-fixtures';
import { sanitizeOriginalFileName } from './original-file-name';

describe('media file validation', () => {
  it('detects JPEG/PNG/WebP from magic bytes and ignores claimed SVG', () => {
    expect(detectMediaMimeType(jpegFixture())).toBe('image/jpeg');
    expect(detectMediaMimeType(pngFixture())).toBe('image/png');
    expect(detectMediaMimeType(webpFixture())).toBe('image/webp');
    expect(detectMediaMimeType(svgFixture())).toBeUndefined();
    expect(detectMediaMimeType(gifFixture())).toBeUndefined();
  });

  it('rejects SVG and empty buffers', () => {
    expect(() =>
      validateInboundMediaFile(
        {
          originalName: 'x.svg',
          claimedMimeType: 'image/svg+xml',
          size: svgFixture().length,
          buffer: svgFixture(),
        },
        5_000_000,
      ),
    ).toThrow(MediaUnsupportedTypeError);

    expect(() =>
      validateInboundMediaFile(
        {
          originalName: 'x.gif',
          claimedMimeType: 'image/gif',
          size: gifFixture().length,
          buffer: gifFixture(),
        },
        5_000_000,
      ),
    ).toThrow(MediaUnsupportedTypeError);

    expect(() =>
      validateInboundMediaFile(
        {
          originalName: 'empty.jpg',
          claimedMimeType: 'image/jpeg',
          size: 0,
          buffer: Buffer.alloc(0),
        },
        5_000_000,
      ),
    ).toThrow(MediaUnsupportedTypeError);
  });

  it('rejects claimed PNG when content is JPEG', () => {
    const jpeg = jpegFixture();
    expect(claimedTypeMatchesDetected('image/png', 'image/jpeg')).toBe(false);
    expect(() =>
      validateInboundMediaFile(
        {
          originalName: 'photo.png',
          claimedMimeType: 'image/png',
          size: jpeg.length,
          buffer: jpeg,
        },
        5_000_000,
      ),
    ).toThrow(MediaUnsupportedTypeError);
  });

  it('accepts octet-stream claimed type when magic bytes are JPEG', () => {
    const jpeg = jpegFixture();
    const validated = validateInboundMediaFile(
      {
        originalName: 'photo.jpg',
        claimedMimeType: 'application/octet-stream',
        size: jpeg.length,
        buffer: jpeg,
      },
      5_000_000,
    );
    expect(validated.mimeType).toBe('image/jpeg');
  });

  it('rejects files over the per-file size bound', () => {
    const jpeg = jpegFixture();
    expect(() =>
      validateInboundMediaFile(
        {
          originalName: 'photo.jpg',
          claimedMimeType: 'image/jpeg',
          size: jpeg.length,
          buffer: jpeg,
        },
        4,
      ),
    ).toThrow(MediaFileTooLargeError);
  });

  it('does not use the raw filename as a storage path and strips traversal', () => {
    expect(sanitizeOriginalFileName('../../etc/passwd.jpg')).toBe('passwd.jpg');
    expect(sanitizeOriginalFileName('a\\b\\c.png')).toBe('c.png');
    expect(sanitizeOriginalFileName('')).toBe('unnamed');
    const jpeg = jpegFixture();
    const validated = validateInboundMediaFile(
      {
        originalName: '../../evil.jpg',
        claimedMimeType: 'image/jpeg',
        size: jpeg.length,
        buffer: jpeg,
      },
      5_000_000,
    );
    expect(validated.originalFileName).toBe('evil.jpg');
    expect(validated.originalFileName).not.toContain('..');
  });

  it('reads PNG and JPEG dimensions from headers', () => {
    expect(readImageDimensions(pngFixture(12, 8), 'image/png')).toEqual({
      width: 12,
      height: 8,
    });
    expect(readImageDimensions(jpegFixture(), 'image/jpeg')).toEqual({
      width: 1,
      height: 1,
    });
    expect(readImageDimensions(webpFixture(), 'image/webp')).toEqual({
      width: 1,
      height: 1,
    });
  });
});
