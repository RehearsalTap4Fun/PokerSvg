import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
// @ts-expect-error 纯 JS 构建插件，无类型声明
import { swPlugin } from './scripts/sw-plugin.mjs'

// 单文件构建：JS/CSS/Worker 全部内联进一个 HTML，file:// 双击即可运行（纯单机形态）
// 注意：Web Worker 必须以 `?worker&inline` 形式引入，否则会拆出独立文件破坏单文件形态
// --mode web（npm run build:web）：同一个单文件页面 + manifest/图标/service worker → dist-web/，
// 部署到服务器后可"添加到主屏幕"全屏打开、离线可玩；单文件版保持零外部引用
export default defineConfig(({ mode }) => {
  const web = mode === 'web'
  const buildId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
  return {
    plugins: [react(), viteSingleFile(), ...(web ? [swPlugin({ version: buildId })] : [])],
    publicDir: web ? 'public' : false,
    define: {
      __PWA__: JSON.stringify(web),
    },
    build: {
      outDir: web ? 'dist-web' : 'dist',
    },
  }
})
