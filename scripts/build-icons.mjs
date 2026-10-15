// 生成 PWA 图标（public/icons/）：由 public/icons/icon.svg 渲染 180/192/512 三个尺寸。
// 与饮食日记、同路同一套手绘语言（米色底、墨色描边、右上角小太阳），蓝色牌桌上两张扇开的牌。
// 用法：node scripts/build-icons.mjs（依赖本机 Chrome）
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'

const OUT = new URL('../public/icons/', import.meta.url)
const svg = readFileSync(new URL('icon.svg', OUT), 'utf8')
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
// 每个尺寸单独开页：同一页改视口偶尔会截到上一尺寸残留的半帧
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<html><body style="margin:0">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`)
  await page.screenshot({ path: new URL(`icon-${size}.png`, OUT).pathname })
  await page.close()
}
await browser.close()
console.log('✓ public/icons/icon-{180,192,512}.png')
