#!/usr/bin/env node
/**
 * 生成 PWA PNG 图标（纯 Node，无外部依赖）。
 * 使用极简 PNG 编码：纯色 + 简单字样近似（靛紫底）。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function writePng(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size)
      const i = row + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function paintIcon(x, y, size) {
  const r = size / 2
  const dx = x - r
  const dy = y - r
  const dist = Math.sqrt(dx * dx + dy * dy)
  // 圆角矩形蒙版
  const radius = size * 0.22
  const ax = Math.max(0, Math.abs(dx) - (r - radius))
  const ay = Math.max(0, Math.abs(dy) - (r - radius))
  const corner = Math.sqrt(ax * ax + ay * ay)
  if (corner > radius) return [0, 0, 0, 0]

  // 底色 #6C6FE8
  let R = 0x6c
  let G = 0x6f
  let B = 0xe8
  // 中心高光
  const t = 1 - Math.min(1, dist / (size * 0.55))
  R = Math.round(R + 30 * t)
  G = Math.round(G + 20 * t)
  B = Math.min(255, Math.round(B + 10 * t))

  // 简化“迹”字区域：白色方块笔画
  const s = size
  const inRect = (x0, y0, x1, y1) => x >= x0 * s && x < x1 * s && y >= y0 * s && y < y1 * s
  const white = inRect(0.28, 0.28, 0.72, 0.36) || inRect(0.28, 0.44, 0.72, 0.52) || inRect(0.44, 0.28, 0.56, 0.72) || inRect(0.28, 0.64, 0.72, 0.72)
  if (white) return [255, 255, 255, 255]
  return [R, G, B, 255]
}

for (const size of [192, 512]) {
  const png = writePng(size, paintIcon)
  const file = join(outDir, `icon-${size}.png`)
  writeFileSync(file, png)
  console.log('wrote', file)
}

writeFileSync(
  join(root, 'public', 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="16" fill="#6C6FE8"/>
  <path d="M18 42V22h8.5c5.2 0 8.5 2.8 8.5 7.2S31.7 36.4 26.5 36.4H23.5V42H18zm5.5-10.2h2.6c2.3 0 3.6-1.1 3.6-2.8s-1.3-2.8-3.6-2.8h-2.6v5.6zM36.5 42l7.2-20h6.1l7.2 20h-5.7l-1.3-3.9h-6.5L42.2 42h-5.7zm8.2-8.2h4.2l-2.1-6.3-2.1 6.3z" fill="#fff"/>
</svg>
`,
)
writeFileSync(
  join(outDir, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#6C6FE8"/><circle cx="32" cy="32" r="10" fill="#fff" opacity=".9"/></svg>`,
)
console.log('icons ready')
