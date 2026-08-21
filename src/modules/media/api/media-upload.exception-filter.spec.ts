import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { MulterError } from 'multer';
import { MediaErrorCode } from '../domain/media-errors';
import { mapUploadTransportError } from './media-upload.exception-filter';

describe('mapUploadTransportError', () => {
  it('maps multer LIMIT_FILE_SIZE and Nest PayloadTooLargeException', () => {
    const fromMulter = mapUploadTransportError(
      new MulterError('LIMIT_FILE_SIZE'),
    );
    const fromNest = mapUploadTransportError(
      new PayloadTooLargeException('File too large'),
    );
    expect(fromMulter?.code).toBe(MediaErrorCode.FILE_TOO_LARGE);
    expect(fromNest?.code).toBe(MediaErrorCode.FILE_TOO_LARGE);
  });

  it('maps too-many-files without echoing unexpected field names', () => {
    const count = mapUploadTransportError(new MulterError('LIMIT_FILE_COUNT'));
    const unexpected = mapUploadTransportError(
      new BadRequestException('Unexpected field - file'),
    );
    expect(count?.code).toBe(MediaErrorCode.TOO_MANY_FILES);
    expect(unexpected?.code).toBe(MediaErrorCode.TOO_MANY_FILES);
    expect(unexpected?.message).toBe('The upload request is invalid.');
    expect(unexpected?.message).not.toContain('file');
  });
});
