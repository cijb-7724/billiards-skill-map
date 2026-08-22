import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name, data) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function drawIcon(size) {
  const scale = 4;
  const width = size * scale;
  const pixels = new Float32Array(width * width * 4);
  const unit = width / 64;

  function blend(x, y, color) {
    if (x < 0 || y < 0 || x >= width || y >= width) return;
    const index = (y * width + x) * 4;
    const alpha = color[3] ?? 1;
    const inverse = 1 - alpha;
    pixels[index] = color[0] * alpha + pixels[index] * inverse;
    pixels[index + 1] = color[1] * alpha + pixels[index + 1] * inverse;
    pixels[index + 2] = color[2] * alpha + pixels[index + 2] * inverse;
    pixels[index + 3] = alpha + pixels[index + 3] * inverse;
  }

  function roundedRect(x1, y1, x2, y2, radius, color) {
    const left = x1 * unit, top = y1 * unit, right = x2 * unit, bottom = y2 * unit, r = radius * unit;
    for (let y = Math.floor(top); y <= Math.ceil(bottom); y++) for (let x = Math.floor(left); x <= Math.ceil(right); x++) {
      const nearX = Math.max(left + r - x, 0, x - (right - r));
      const nearY = Math.max(top + r - y, 0, y - (bottom - r));
      if (nearX * nearX + nearY * nearY <= r * r) blend(x, y, color);
    }
  }

  function circle(cx, cy, radius, color) {
    const x0 = cx * unit, y0 = cy * unit, r = radius * unit;
    for (let y = Math.floor(y0 - r); y <= Math.ceil(y0 + r); y++) for (let x = Math.floor(x0 - r); x <= Math.ceil(x0 + r); x++) {
      if ((x - x0) ** 2 + (y - y0) ** 2 <= r * r) blend(x, y, color);
    }
  }

  function line(x1, y1, x2, y2, thickness, color) {
    const ax = x1 * unit, ay = y1 * unit, bx = x2 * unit, by = y2 * unit, radius = thickness * unit / 2;
    const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
    for (let y = Math.floor(Math.min(ay, by) - radius); y <= Math.ceil(Math.max(ay, by) + radius); y++) for (let x = Math.floor(Math.min(ax, bx) - radius); x <= Math.ceil(Math.max(ax, bx) + radius); x++) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
      if ((x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2 <= radius * radius) blend(x, y, color);
    }
  }

  roundedRect(2, 2, 62, 62, 14, [12, 34, 27, 1]);
  roundedRect(5, 7, 59, 57, 11, [100, 54, 29, 1]);
  roundedRect(7, 9, 57, 55, 9, [205, 164, 82, 1]);
  roundedRect(11, 13, 53, 51, 6, [12, 111, 83, 1]);

  const pocket = [3, 10, 8, 1];
  [[11, 13], [32, 13], [53, 13], [11, 51], [32, 51], [53, 51]].forEach(([x, y]) => circle(x, y, 4.2, pocket));

  line(14, 49, 43, 20, 4.2, [45, 27, 18, 1]);
  line(17, 46, 43, 20, 2.4, [226, 190, 126, 1]);
  circle(39, 25, 8.1, [5, 25, 19, .24]);
  circle(38, 24, 7.1, [247, 245, 236, 1]);
  circle(40.1, 21.9, 2.05, [194, 58, 48, 1]);
  circle(35.6, 21.5, 1.35, [255, 255, 255, .65]);

  const output = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    output[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const source = (((y * scale + sy) * width + x * scale + sx) * 4);
        for (let channel = 0; channel < 4; channel++) sums[channel] += pixels[source + channel];
      }
      const target = y * (size * 4 + 1) + 1 + x * 4;
      output[target] = Math.round(sums[0] / (scale * scale));
      output[target + 1] = Math.round(sums[1] / (scale * scale));
      output[target + 2] = Math.round(sums[2] / (scale * scale));
      output[target + 3] = Math.round(sums[3] / (scale * scale) * 255);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(output, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(new URL("../public/favicon.png", import.meta.url), drawIcon(64));
writeFileSync(new URL("../public/apple-touch-icon.png", import.meta.url), drawIcon(180));
