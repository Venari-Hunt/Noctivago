import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createZip, readZip } from '../src/main/zip.js'

// The phone app (fflate) and Windows Explorer read entry names as UTF-8 only
// when flag bit 11 is set; without it "｜" or "é" in a sound's file name
// broke the phone import (owner, 2026-10-18).
test('zip entry names are flagged as UTF-8 in both headers', () => {
  const name = 'audio/Encampment ｜ Forest picolé.opus'
  const zip = createZip([{ name, data: Buffer.from('abc') }])
  assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800)
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.equal(zip.readUInt16LE(central + 8) & 0x0800, 0x0800)
  assert.deepEqual(readZip(zip).map((e) => e.name), [name])
})
