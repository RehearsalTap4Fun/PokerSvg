import { useSyncExternalStore } from 'react'

// 三种布局：桌面（原样）/ 竖屏（手机、竖放平板）/ 横屏手机（宽桌）。
// 结果同时写到 <html data-layout>，CSS 与组件读同一个来源，避免两套断点各说各话。
export type Layout = 'desktop' | 'portrait' | 'landscape'

const Q_LANDSCAPE = '(orientation: landscape) and (max-height: 520px)'
const Q_PORTRAIT = '(orientation: portrait) and (max-width: 1024px)'

function compute(): Layout {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop'
  if (window.matchMedia(Q_LANDSCAPE).matches) return 'landscape'
  if (window.matchMedia(Q_PORTRAIT).matches) return 'portrait'
  return 'desktop'
}

let current: Layout = compute()
const subs = new Set<() => void>()

function update() {
  const next = compute()
  if (next === current) return
  current = next
  document.documentElement.dataset.layout = next
  subs.forEach((f) => f())
}

export function initLayout() {
  document.documentElement.dataset.layout = current
  for (const q of [Q_LANDSCAPE, Q_PORTRAIT]) window.matchMedia(q).addEventListener('change', update)
  window.addEventListener('resize', update)
}

function subscribe(f: () => void) {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

export function useLayout(): Layout {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 'desktop',
  )
}
