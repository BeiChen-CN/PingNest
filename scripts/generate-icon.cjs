/**
 * 应用图标生成：从 scripts/icon-source.png 生成
 *   - public/icon.png（512x512，UI 内引用）
 *   - public/icon.ico（16/24/32/48/64/128/256，窗口/托盘/安装包）
 *
 * 源图是白底、无透明通道，先用"四角泛洪填充"把圆角外的白底转为透明
 * （不能做全局白色阈值——图标主体本身是极浅的奶油绿）。
 * 用法：node scripts/generate-icon.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const Jimp = require('jimp')
const pngToIco = require('png-to-ico')

const SOURCE = path.join(__dirname, 'icon-source.png')
const OUT_PNG = path.join(__dirname, '..', 'public', 'icon.png')
const OUT_ICO = path.join(__dirname, '..', 'public', 'icon.ico')

// 与白色角底的判定阈值：三个通道都不低于该值才视为背景。
// 背景白实测 ≥ (254,253,249)，图标主体奶油绿的蓝色通道 ≤ 236，244 在两者之间。
const BG_THRESHOLD = 244

/** 从四边所有像素出发，把连通的近白背景的 alpha 置 0（BFS） */
function floodFillBackground(image) {
  const { width, height, data } = image.bitmap
  const visited = new Uint8Array(width * height)
  const queue = []
  const pushIfBackground = (x, y) => {
    const idx = (y * width + x) * 4
    const visitedIdx = y * width + x
    if (visited[visitedIdx]) return
    if (data[idx] < BG_THRESHOLD || data[idx + 1] < BG_THRESHOLD || data[idx + 2] < BG_THRESHOLD) return
    visited[visitedIdx] = 1
    queue.push(x, y)
  }

  for (let x = 0; x < width; x++) {
    pushIfBackground(x, 0)
    pushIfBackground(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    pushIfBackground(0, y)
    pushIfBackground(width - 1, y)
  }

  while (queue.length) {
    const y = queue.pop()
    const x = queue.pop()
    const idx = (y * width + x) * 4
    data[idx + 3] = 0
    if (x > 0) pushIfBackground(x - 1, y)
    if (x < width - 1) pushIfBackground(x + 1, y)
    if (y > 0) pushIfBackground(x, y - 1)
    if (y < height - 1) pushIfBackground(x, y + 1)
  }
}

/** 清理圆角边缘残留的抗锯齿白边：与透明区域相邻的近白像素逐步置透明 */
function clearNearWhiteRim(image) {
  for (let pass = 0; pass < 2; pass++) {
    const { width, height, data } = image.bitmap
    const toClear = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        if (data[idx + 3] === 0) continue
        if (data[idx] < 240 || data[idx + 1] < 240 || data[idx + 2] < 240) continue
        const touchesTransparent =
          (x > 0 && data[idx - 4 + 3] === 0) ||
          (x < width - 1 && data[idx + 4 + 3] === 0) ||
          (y > 0 && data[idx - width * 4 + 3] === 0) ||
          (y < height - 1 && data[idx + width * 4 + 3] === 0)
        if (touchesTransparent) toClear.push(idx)
      }
    }
    for (const idx of toClear) data[idx + 3] = 0
  }
}

async function main() {
  const image = await Jimp.read(SOURCE)
  floodFillBackground(image)
  clearNearWhiteRim(image)

  const png512 = image.clone().resize(512, 512, Jimp.RESIZE_BICUBIC)
  fs.writeFileSync(OUT_PNG, await png512.getBufferAsync(Jimp.MIME_PNG))
  console.log('[generate-icon] wrote ' + OUT_PNG)

  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngBuffers = []
  for (const size of sizes) {
    const resized = image.clone().resize(size, size, Jimp.RESIZE_BICUBIC)
    pngBuffers.push(await resized.getBufferAsync(Jimp.MIME_PNG))
  }
  const ico = await pngToIco(pngBuffers)
  fs.writeFileSync(OUT_ICO, ico)
  console.log('[generate-icon] wrote ' + OUT_ICO + ' (' + sizes.join('/') + ')')

  // 自检：512 图的四角应透明、中心应不透明
  const check = await Jimp.read(OUT_PNG)
  const at = (x, y) => check.bitmap.data[(y * 512 + x) * 4 + 3]
  const corners = [at(2, 2), at(509, 2), at(2, 509), at(509, 509)]
  const center = at(256, 256)
  if (corners.some((a) => a !== 0) || center === 0) {
    throw new Error('透明化自检失败：corners=' + corners.join(',') + ' center=' + center)
  }
  console.log('[generate-icon] alpha check ok (corners transparent, center opaque)')
}

main().catch((error) => {
  console.error('[generate-icon] failed:', error)
  process.exit(1)
})
