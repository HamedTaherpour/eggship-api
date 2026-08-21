export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Best-effort header dimensions for JPEG/PNG/WebP. Returns null when the
 * container is valid enough to accept but dimensions cannot be parsed.
 * This is not a full image decoder and does not execute embedded content.
 */
export function readImageDimensions(
  buffer: Buffer,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
): ImageDimensions | null {
  switch (mimeType) {
    case 'image/png':
      return readPngDimensions(buffer);
    case 'image/jpeg':
      return readJpegDimensions(buffer);
    case 'image/webp':
      return readWebpDimensions(buffer);
  }
}

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  // IHDR: 8-byte signature + 4 length + 4 'IHDR' + 4 width + 4 height
  if (buffer.length < 24) {
    return null;
  }
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return positiveDimensions(width, height);
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === undefined || marker === 0x00 || marker === 0xff) {
      offset += 1;
      continue;
    }
    // SOF0 / SOF1 / SOF2 (baseline / extended / progressive)
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3
    ) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return positiveDimensions(width, height);
    }
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (offset + 3 >= buffer.length) {
      break;
    }
    const size = buffer.readUInt16BE(offset + 2);
    if (size < 2) {
      break;
    }
    offset += 2 + size;
  }
  return null;
}

function readWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30) {
    return null;
  }
  if (
    buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return null;
  }

  const chunk = buffer.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X' && buffer.length >= 30) {
    const width = 1 + (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16));
    const height = 1 + (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16));
    return positiveDimensions(width, height);
  }
  if (chunk === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return positiveDimensions(width, height);
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    // Lossy VP8 intraframe start code 0x9d 0x01 0x2a then 16-bit width/height
    const start = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (start === -1 || start + 7 > buffer.length) {
      return null;
    }
    const width = buffer.readUInt16LE(start + 3) & 0x3fff;
    const height = buffer.readUInt16LE(start + 5) & 0x3fff;
    return positiveDimensions(width, height);
  }
  return null;
}

function positiveDimensions(
  width: number,
  height: number,
): ImageDimensions | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return null;
  }
  return { width, height };
}
