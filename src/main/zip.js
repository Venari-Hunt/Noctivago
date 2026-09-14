import zlib from 'node:zlib'

// A tiny, dependency-free ZIP reader/writer - just enough for the portable
// preset bundle (src/main/presetPortable.js): a handful of files packed into
// one .ncvpreset. Writing is "stored" (no compression) since preset audio is
// almost always an already-compressed format (mp3/ogg/opus/m4a/flac) and the
// manifest JSON is tiny; reading also understands DEFLATE so a bundle
// re-zipped by Explorer or 7-Zip still opens. Deliberately not a general ZIP
// library - no zip64, no encryption, no directory entries.

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// entries: [{ name: string, data: Buffer }] -> Buffer
export function createZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: stored
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0x21, 12) // mod date (1980-01-01, a valid placeholder)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18) // compressed size
    local.writeUInt32LE(data.length, 22) // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    localParts.push(local, nameBuf, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_SIG, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(0, 10) // method
    central.writeUInt16LE(0, 12) // mod time
    central.writeUInt16LE(0x21, 14) // mod date
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42) // local header offset
    centralParts.push(central, nameBuf)

    offset += local.length + nameBuf.length + data.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const localBuf = Buffer.concat(localParts)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // disk with central directory
  eocd.writeUInt16LE(entries.length, 8) // entries on this disk
  eocd.writeUInt16LE(entries.length, 10) // total entries
  eocd.writeUInt32LE(centralBuf.length, 12) // central directory size
  eocd.writeUInt32LE(localBuf.length, 16) // central directory offset
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([localBuf, centralBuf, eocd])
}

export function looksLikeZip(buf) {
  return buf && buf.length >= 4 && buf.readUInt32LE(0) === LOCAL_SIG
}

// Buffer -> [{ name, data: Buffer }]. Walks the central directory (the
// authoritative index) rather than scanning local headers. Throws on a
// malformed archive.
export function readZip(buf) {
  if (buf.length < 22) throw new Error('Not a zip archive (too small)')

  // Find the End Of Central Directory record - normally the last 22 bytes,
  // but a trailing comment can push it back, so scan from the end.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error('Not a zip archive (no end-of-central-directory record)')

  const total = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)
  const out = []

  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(ptr) !== CENTRAL_SIG) throw new Error('Corrupt zip central directory')
    const method = buf.readUInt16LE(ptr + 10)
    const crc = buf.readUInt32LE(ptr + 16)
    const compSize = buf.readUInt32LE(ptr + 20)
    const uncompSize = buf.readUInt32LE(ptr + 24)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOffset = buf.readUInt32LE(ptr + 42)
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen)
    ptr += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue // directory entry, no data

    // The local header repeats the name/extra with its own (possibly
    // different) extra length, so re-read it to find where the data starts.
    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error('Corrupt zip local header')
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)

    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = zlib.inflateRawSync(raw)
    else throw new Error(`Unsupported zip compression method ${method} for "${name}"`)

    if (data.length !== uncompSize) throw new Error(`Size mismatch for "${name}"`)
    if (crc32(data) !== crc) throw new Error(`Checksum mismatch for "${name}"`)

    out.push({ name, data })
  }

  return out
}
