import { mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
if (manifest.version !== packageInfo.version) throw new Error("Package and manifest versions differ.");
const files = ["main.js", "manifest.json", "styles.css", "LICENSE"];
const directory = path.join("dist", manifest.id);
await mkdir(directory, { recursive: true });
const entries = [];
for (const file of files) {
  const data = await readFile(file);
  if (!data.length) throw new Error(`${file} is empty.`);
  await copyFile(file, path.join(directory, file));
  entries.push({ name: `${manifest.id}/${file}`, data });
}

// Standard ZIP with uncompressed entries: no archive dependency is required for
// this small plugin. CRCs let Windows and other ZIP readers validate each file.
function crc32(data) {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const local = [];
const central = [];
let offset = 0;
for (const { name, data } of entries) {
  const filename = Buffer.from(name, "utf8");
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(33, 12); // 1980-01-01: reproducible archive date.
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(filename.length, 26);
  local.push(header, filename, data);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(33, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(data.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(filename.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, filename);
  offset += header.length + filename.length + data.length;
}
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(central.reduce((size, buffer) => size + buffer.length, 0), 12);
end.writeUInt32LE(offset, 16);
const archive = path.join("dist", `${manifest.id}-${manifest.version}.zip`);
await writeFile(archive, Buffer.concat([...local, ...central, end]));
console.log(`Packaged ${archive}`);
