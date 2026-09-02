// 筹码数字的紧凑显示："12.5K" / "1.2M"。
// 仅影响展示层；引擎与分析全程使用精确整数。
// 阈值取 10000：常规 SNG 前中期（≤9999）保持精确数字，后期大筹码自动缩写。

export function fmtChips(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return trimZero(n / 1_000_000) + 'M'
  if (abs >= 10_000) return trimZero(n / 1_000) + 'K'
  return String(n)
}

function trimZero(x: number): string {
  const s = x.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}
