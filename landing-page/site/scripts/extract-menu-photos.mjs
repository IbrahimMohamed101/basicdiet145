import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

// Build-time unpacking: the immutable photo archive is checked into the repo
// as text chunks, while website visitors receive ordinary local static images.
const site = process.cwd();
const partFolder = resolve(site, 'assets/menu-photos');
const parts = [1, 2, 3, 4].map((i) => readFileSync(join(partFolder, 'pack-' + String(i).padStart(2, '0') + '.b64'), 'utf8').trim());
const zip = Buffer.from(parts.join(''), 'base64');
const expectedHash = '4c20e0adcdd7e5e472bddaeb94349b18d8bd0efcea894e08045f59eae2a88904';
if (createHash('sha256').update(zip).digest('hex') !== expectedHash) throw new Error('Menu photo pack checksum failed');

let endRecord = -1;
for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
  if (zip.readUInt32LE(i) === 0x06054b50) { endRecord = i; break; }
}
if (endRecord < 0) throw new Error('Invalid menu photo ZIP');
const entryCount = zip.readUInt16LE(endRecord + 10);
let cursor = zip.readUInt32LE(endRecord + 16);
const output = resolve(site, 'public/menu-images');
mkdirSync(output, { recursive: true });

let written = 0;
for (let entry = 0; entry < entryCount; entry++) {
  if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Corrupted menu ZIP central directory');
  const method = zip.readUInt16LE(cursor + 10);
  const compressedSize = zip.readUInt32LE(cursor + 20);
  const uncompressedSize = zip.readUInt32LE(cursor + 24);
  const filenameLength = zip.readUInt16LE(cursor + 28);
  const extraLength = zip.readUInt16LE(cursor + 30);
  const commentLength = zip.readUInt16LE(cursor + 32);
  const localOffset = zip.readUInt32LE(cursor + 42);
  const name = zip.subarray(cursor + 46, cursor + 46 + filenameLength).toString('utf8');
  cursor += 46 + filenameLength + extraLength + commentLength;
  if (!/^webp\/pos_\d+\.webp$/.test(name)) continue;
  if (uncompressedSize > 1024 * 1024 || ![0, 8].includes(method) || zip.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error('Unsafe menu photo entry: ' + name);
  }
  const dataOffset = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
  const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);
  const picture = method === 8 ? inflateRawSync(compressed) : compressed;
  if (picture.length !== uncompressedSize || picture.toString('ascii', 0, 4) !== 'RIFF' || picture.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Invalid menu photo data: ' + name);
  }
  writeFileSync(join(output, name.split('/')[1]), picture);
  written++;
}
if (written !== 36) throw new Error('Expected 36 menu photos, found ' + written);
// Independent ingredient photos for the interactive meal builder.
// Kept as readable base64 assets because the production menu has an existing
// deterministic build-time photo unpacking pipeline.
const builderImageNames = ['biryani_rice', 'quinoa', 'sweet_potato'];
for (const name of builderImageNames) {
  const encoded = readFileSync(resolve(site, 'assets/builder-photos', name + '.b64'), 'utf8').trim();
  const picture = Buffer.from(encoded, 'base64');
  if (picture.length < 1000 || picture.length > 512 * 1024 ||
      picture.toString('ascii', 0, 4) !== 'RIFF' ||
      picture.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Invalid builder photo: ' + name);
  }
  writeFileSync(join(output, 'builder_' + name + '.webp'), picture);
}
console.log('Basic Diet menu: extracted ' + written + ' labeled product images and ' + builderImageNames.length + ' illustrative ingredient images.');
