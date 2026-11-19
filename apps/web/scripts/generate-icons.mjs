// Génère les icônes PNG de la PWA (même dessin que public/favicon.svg), sans dépendance.
// Icône provisoire : à remplacer par le logo SPIE validé. Usage : pnpm --filter @spie/web icons
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BRAND = [0x0b, 0x3a, 0x75];
const WHITE = [0xff, 0xff, 0xff];
const LIGHT = [0xcb, 0xd8, 0xea];

/** Couleur d'un point en coordonnées 0..64 (repère du favicon SVG). */
function colorAt(x, y) {
  const inDoc = x >= 20 && x <= 46 && y >= 12 && y <= 52 && !(x > 37 && y < 21 && x - 37 > y - 12);
  if (!inDoc) return BRAND;
  if (x >= 37 && y <= 21 && x - 37 <= y - 12) return LIGHT;
  const line = (cy, x1, x2) => Math.abs(y - cy) <= 1.5 && x >= x1 && x <= x2;
  if (line(30, 25, 41) || line(36, 25, 41) || line(42, 25, 35)) return BRAND;
  return WHITE;
}

function render(size) {
  const ss = 4; // suréchantillonnage pour l'anticrénelage
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3); // octet de filtre 0 + RGB
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt(((px + (sx + 0.5) / ss) / size) * 64, ((py + (sy + 0.5) / ss) / size) * 64);
          for (let i = 0; i < 3; i++) acc[i] += c[i];
        }
      }
      for (let i = 0; i < 3; i++) row[1 + px * 3 + i] = Math.round(acc[i] / (ss * ss));
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = new URL("../public/", import.meta.url);
for (const [name, size] of [
  ["pwa-192.png", 192],
  ["pwa-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(new URL(name, out), render(size));
  console.log(`${name} (${size}×${size})`);
}
