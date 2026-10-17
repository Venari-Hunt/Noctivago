// Minimal Ogg Opus packet reader/writer, so separately encoded pieces of one
// export can be stitched into a single stream packet by packet (see
// segmentedEncode.js). Pure (Buffers in, Buffers out) so it can be
// unit-tested. Spec: RFC 3533 (Ogg pages) and RFC 7845 (Ogg Opus).

export const OPUS_RATE = 48000

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
    table[i] = r >>> 0
  }
  return table
})()

function oggCrc(buf) {
  let crc = 0
  for (let i = 0; i < buf.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0
  return crc
}

// Every packet of the stream's first logical bitstream, in order. A packet
// may continue across pages (lacing value 255 at a page's end).
export function readOggPackets(buf) {
  const packets = []
  let pending = []
  let pos = 0
  while (pos + 27 <= buf.length) {
    if (buf.toString('latin1', pos, pos + 4) !== 'OggS') throw new Error(`Bad Ogg page at byte ${pos}`)
    const nSegs = buf[pos + 26]
    const lacing = buf.subarray(pos + 27, pos + 27 + nSegs)
    let dataPos = pos + 27 + nSegs
    for (const len of lacing) {
      pending.push(buf.subarray(dataPos, dataPos + len))
      dataPos += len
      if (len < 255) {
        packets.push(Buffer.concat(pending))
        pending = []
      }
    }
    pos = dataPos
  }
  if (pending.length) packets.push(Buffer.concat(pending))
  return packets
}

// Samples (at 48 kHz) one Opus packet decodes to, from its TOC byte
// (RFC 6716 section 3.1).
export function opusPacketSamples(packet) {
  const toc = packet[0]
  const config = toc >> 3
  let frame
  if (config < 12) frame = [480, 960, 1920, 2880][config & 3]
  else if (config < 16) frame = [480, 960][config & 1]
  else frame = [120, 240, 480, 960][config & 3]
  const code = toc & 3
  const count = code === 0 ? 1 : code === 3 ? packet[1] & 0x3f : 2
  return frame * count
}

export function opusPreSkip(head) {
  return head.readUInt16LE(10)
}

function page({ packets, granule, serial, seq, flags }) {
  const lacing = []
  for (const p of packets) {
    let n = p.length
    while (n >= 255) {
      lacing.push(255)
      n -= 255
    }
    lacing.push(n)
  }
  const header = Buffer.alloc(27 + lacing.length)
  header.write('OggS', 0, 'latin1')
  header[5] = flags
  header.writeBigInt64LE(BigInt(granule), 6)
  header.writeUInt32LE(serial, 14)
  header.writeUInt32LE(seq, 18)
  header[26] = lacing.length
  Buffer.from(lacing).copy(header, 27)
  const out = Buffer.concat([header, ...packets])
  out.writeUInt32LE(oggCrc(out), 22)
  return out
}

// Writes an Ogg Opus stream page by page through `write(buffer)` (may be
// async): `head` (OpusHead) and `tags` (OpusTags) on their own pages, then
// every packet passed to add(). end(totalSamples) writes the last page;
// `totalSamples` (48 kHz, excluding the head's pre-skip) sets its granule,
// which trims the stream to that exact length. Packets never span pages.
export function createOggOpusWriter({ head, tags, write, serial = 0x4e435647 }) {
  let seq = 0
  let granule = 0
  let batch = []
  let lacingCount = 0
  const emit = (packets, pageGranule, flags) => write(page({ packets, granule: pageGranule, serial, seq: seq++, flags }))
  let ready = Promise.resolve(emit([head], 0, 2)).then(() => emit([tags], 0, 0))
  return {
    async add(packet) {
      await ready
      const laces = Math.floor(packet.length / 255) + 1
      if (lacingCount + laces > 255 || batch.length >= 50) {
        const full = batch
        batch = []
        lacingCount = 0
        await emit(full, granule, 0)
      }
      batch.push(packet)
      lacingCount += laces
      granule += opusPacketSamples(packet)
    },
    async end(totalSamples) {
      await ready
      await emit(batch, opusPreSkip(head) + totalSamples, 4)
    }
  }
}
