/** Tiny valid-enough images for signature, dimension, and upload tests. */

export function pngFixture(width = 1, height = 1): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const ihdr = pngChunk('IHDR', ihdrData);
  const idat = pngChunk(
    'IDAT',
    Buffer.from([
      0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x02, 0x00,
      0x01,
    ]),
  );
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

export function jpegFixture(): Buffer {
  // SOI + SOF0 1x1 + EOI. Enough for signature and dimension parsing.
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01,
    0x11, 0x00, 0xff, 0xd9,
  ]);
}

export function webpFixture(): Buffer {
  const body = Buffer.alloc(18);
  body.write('VP8X', 0, 'ascii');
  body.writeUInt32LE(10, 4);
  body[8] = 0;
  // canvas width-1 and height-1 as 24-bit little endian → 1x1
  body[12] = 0;
  body[13] = 0;
  body[14] = 0;
  body[15] = 0;
  body[16] = 0;
  body[17] = 0;
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WEBP', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

export function gifFixture(): Buffer {
  // GIF89a header is enough for signature rejection tests.
  return Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x00,
  ]);
}

export function svgFixture(): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    'utf8',
  );
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
