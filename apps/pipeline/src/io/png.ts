import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }

  return table;
})();

const crc32 = (buffers: Buffer[]) => {
  let crc = 0xffffffff;

  for (const buffer of buffers) {
    for (const byte of buffer) {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([typeBuffer, data]), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
};

const drawLine = (
  pixels: Buffer,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number
) => {
  const dx = Math.abs(x2 - x1);
  const sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1);
  const sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  let x = x1;
  let y = y1;

  while (true) {
    drawDot(pixels, width, height, x, y, thickness);

    if (x === x2 && y === y2) {
      break;
    }

    const nextError = 2 * error;
    if (nextError >= dy) {
      error += dy;
      x += sx;
    }
    if (nextError <= dx) {
      error += dx;
      y += sy;
    }
  }
};

const drawDot = (
  pixels: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number
) => {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    if (y < 0 || y >= height) {
      continue;
    }

    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (x < 0 || x >= width) {
        continue;
      }

      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const index = (y * width + x) * 3;
        pixels[index] = 0;
        pixels[index + 1] = 0;
        pixels[index + 2] = 0;
      }
    }
  }
};

const drawEllipse = (
  pixels: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  thickness: number
) => {
  const steps = Math.max(120, Math.ceil(Math.PI * Math.max(rx, ry)));
  let previousX = cx + rx;
  let previousY = cy;

  for (let i = 1; i <= steps; i += 1) {
    const theta = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(theta) * rx);
    const y = Math.round(cy + Math.sin(theta) * ry);
    drawLine(pixels, width, height, previousX, previousY, x, y, thickness);
    previousX = x;
    previousY = y;
  }
};

const drawRect = (
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  thickness: number
) => {
  drawLine(pixels, width, height, x, y, x + rectWidth, y, thickness);
  drawLine(
    pixels,
    width,
    height,
    x + rectWidth,
    y,
    x + rectWidth,
    y + rectHeight,
    thickness
  );
  drawLine(
    pixels,
    width,
    height,
    x + rectWidth,
    y + rectHeight,
    x,
    y + rectHeight,
    thickness
  );
  drawLine(pixels, width, height, x, y + rectHeight, x, y, thickness);
};

export const writeMockColoringPagePng = async (
  path: string,
  width: 2480,
  height: 3508
) => {
  const pixels = Buffer.alloc(width * height * 3, 255);
  const line = 20;

  drawEllipse(pixels, width, height, 1240, 1320, 360, 420, line);
  drawEllipse(pixels, width, height, 1100, 1210, 38, 52, line);
  drawEllipse(pixels, width, height, 1380, 1210, 38, 52, line);
  drawLine(pixels, width, height, 1130, 1480, 1350, 1480, line);
  drawEllipse(pixels, width, height, 1240, 2320, 520, 680, line);
  drawLine(pixels, width, height, 860, 2050, 520, 2520, line);
  drawLine(pixels, width, height, 1620, 2050, 1960, 2520, line);
  drawLine(pixels, width, height, 1050, 2950, 960, 3320, line);
  drawLine(pixels, width, height, 1430, 2950, 1520, 3320, line);
  drawRect(pixels, width, height, 1660, 2600, 300, 320, line);
  drawLine(pixels, width, height, 600, 3180, 1900, 3180, line);
  drawLine(pixels, width, height, 560, 3360, 1960, 3360, line);

  const rawRows: Buffer[] = [];
  const rowLength = width * 3;
  for (let y = 0; y < height; y += 1) {
    rawRows.push(Buffer.from([0]));
    rawRows.push(pixels.subarray(y * rowLength, (y + 1) * rowLength));
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rawRows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  await writeFile(path, png);
};
