import type React from 'react'

// 移动端界面用的线性图标：24 网格、1.8 描边、圆角端点，统一一套笔触
function Icon({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export const IconMore = () => (
  <Icon>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
  </Icon>
)

export const IconFast = () => (
  <Icon>
    <path d="M4 6.5v11l7-5.5z" />
    <path d="M13 6.5v11l7-5.5z" />
  </Icon>
)

export const IconMic = () => (
  <Icon>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Icon>
)

export const IconSound = () => (
  <Icon>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
)

export const IconMute = () => (
  <Icon>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M16 10l4 4M20 10l-4 4" />
  </Icon>
)

export const IconTag = () => (
  <Icon>
    <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0z" />
    <circle cx="8" cy="8" r="1.3" />
  </Icon>
)

export const IconGrid = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" />
  </Icon>
)

export const IconChart = () => (
  <Icon size={16}>
    <path d="M5 19V11M12 19V5M19 19v-6" />
  </Icon>
)

export const IconExit = () => (
  <Icon>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Icon>
)

export const IconClose = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)

export const IconBack = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
)

export const IconEye = () => (
  <Icon>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

export const IconReport = () => (
  <Icon>
    <rect x="5" y="3.5" width="14" height="17" rx="2" />
    <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
  </Icon>
)

export const IconDownload = () => (
  <Icon>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
  </Icon>
)
