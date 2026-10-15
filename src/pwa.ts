/**
 * web 版（npm run build:web）专用：注册 service worker，申请持久化存储。
 * 单文件版（__PWA__ = false）与 file:// 打开时什么都不做。
 * 新版本由 SW 在后台装好后接管，下次打开即是新版；不在牌局中途强制刷新。
 */
export function setupPWA() {
  if (!__PWA__ || location.protocol === 'file:' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // 主屏幕 App 常年不关，回到前台时检查一次更新
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {})
        })
      })
      .catch(() => {
        // 注册失败不影响游玩
      })
    // 尽量避免浏览器在空间紧张时清掉存档（localStorage）与离线缓存
    navigator.storage?.persist?.().catch(() => {})
  })
}
