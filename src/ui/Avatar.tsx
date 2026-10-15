import type React from 'react'
import type { AiStyleId } from '../core/types'
import { HUMAN_COLOR, STYLES } from '../ai/styles'

// 陪练头像：与应用图标同一套手绘语言（墨色描边、平涂块面）。64 网格，头部居中、肩膀出框，
// 由外层圆形容器裁切；最小显示约 30px，五官必须粗、少、抓标志特征。

const INK = '#2C2E2A'
const LINE = {
  stroke: INK,
  strokeWidth: 2.4,
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
} as const

const SKIN = {
  light: '#F7D5B5',
  fair: '#FADFC8',
  warm: '#EFC49C',
  tan: '#DDA67A',
  deep: '#8D5B3E',
}

// —— 部件 ——

const Body = ({ fill }: { fill: string }) => <path d="M5 70C5 55 16 49.5 32 49.5C48 49.5 59 55 59 70Z" fill={fill} {...LINE} />
const Neck = ({ skin }: { skin: string }) => <path d="M26.5 41V50.5Q32 54 37.5 50.5V41Z" fill={skin} {...LINE} />
const Ears = ({ skin }: { skin: string }) => (
  <>
    <circle cx="18.5" cy="32" r="3.4" fill={skin} {...LINE} />
    <circle cx="45.5" cy="32" r="3.4" fill={skin} {...LINE} />
  </>
)
const Head = ({ skin, stroke = true }: { skin: string; stroke?: boolean }) => (
  <ellipse cx="32" cy="31" rx="14" ry="16" fill={skin} {...(stroke ? LINE : {})} />
)
const HeadLine = () => <ellipse cx="32" cy="31" rx="14" ry="16" fill="none" {...LINE} />
const Eyes = ({ y = 31.5, r = 2.1 }: { y?: number; r?: number }) => (
  <>
    <circle cx="26.5" cy={y} r={r} fill={INK} />
    <circle cx="37.5" cy={y} r={r} fill={INK} />
  </>
)
const Brows = ({ y = 26, tilt = 0 }: { y?: number; tilt?: number }) => (
  <path d={`M23.5 ${y + tilt}L29 ${y - tilt}M35 ${y - tilt}L40.5 ${y + tilt}`} fill="none" {...LINE} />
)
const Nose = () => <path d="M32 33.5Q30.4 36 32.6 36.4" fill="none" {...LINE} strokeWidth={1.8} />
const Blush = () => (
  <>
    <circle cx="22.5" cy="37" r="2.4" fill="#F08A7A" opacity="0.45" />
    <circle cx="41.5" cy="37" r="2.4" fill="#F08A7A" opacity="0.45" />
  </>
)

const MOUTH = {
  smile: <path d="M27.5 39.5Q32 43.5 36.5 39.5" fill="none" {...LINE} />,
  small: <path d="M29.5 40.5Q32 42 34.5 40.5" fill="none" {...LINE} />,
  smirk: <path d="M28 41Q32.5 42 36.5 38.5" fill="none" {...LINE} />,
  flat: <path d="M28.5 41H35.5" fill="none" {...LINE} />,
  frown: <path d="M28.5 42Q32 39.5 35.5 42" fill="none" {...LINE} />,
  grin: <path d="M26 38.5Q32 40 38 38.5Q37 45.5 32 45.5Q27 45.5 26 38.5Z" fill="#FFFFFF" {...LINE} />,
  open: <ellipse cx="32" cy="41.5" rx="4.2" ry="3.6" fill={INK} />,
}

const RoundGlasses = ({ fill = '#FFFFFF', opacity = 0.35, r = 4.8 }: { fill?: string; opacity?: number; r?: number }) => (
  <>
    <circle cx="26.5" cy="31.5" r={r} fill={fill} fillOpacity={opacity} {...LINE} strokeWidth={2} />
    <circle cx="37.5" cy="31.5" r={r} fill={fill} fillOpacity={opacity} {...LINE} strokeWidth={2} />
    <path d={`M${26.5 + r} 31H${37.5 - r}`} {...LINE} strokeWidth={2} />
  </>
)
const Shades = () => (
  <>
    <path d="M17.5 28.5H46.5V31C46.5 34.6 43.6 36.3 40 36.3C36.6 36.3 34 34.2 32 32.2C30 34.2 27.4 36.3 24 36.3C20.4 36.3 17.5 34.6 17.5 31Z" fill={INK} {...LINE} strokeWidth={1.6} />
    <path d="M21 30.6H25.5M35.5 30.6H40" stroke="#FFFFFF" strokeWidth={1.4} strokeLinecap="round" opacity="0.7" />
  </>
)
const Collar = ({ fill = '#FFFFFF' }: { fill?: string }) => (
  <path d="M25 50L32 57L39 50L36.5 48.5L32 52L27.5 48.5Z" fill={fill} {...LINE} strokeWidth={2} />
)

// —— 角色 ——

type Face = () => React.ReactNode

const FACES: Record<string, Face> = {
  // 菲尔·艾维：深肤色、光头、一圈短胡、出名的冷峻盯视
  'pro-ivey': () => (
    <>
      <Body fill="#2F3238" />
      <Neck skin={SKIN.deep} />
      <Ears skin={SKIN.deep} />
      <Head skin={SKIN.deep} stroke={false} />
      <path d="M18.6 27C19 19.5 24.5 15 32 15C39.5 15 45 19.5 45.4 27C42 22.8 37.8 21.2 32 21.2C26.2 21.2 22 22.8 18.6 27Z" fill="#3E281C" opacity="0.55" />
      <path d="M18.4 35C19.5 43.5 25 47 32 47C39 47 44.5 43.5 45.6 35C43.5 40 39 42.5 32 42.5C25 42.5 20.5 40 18.4 35Z" fill="#3E281C" />
      <path d="M27 38.2Q32 36.4 37 38.2Q36 39.8 32 39.4Q28 39.8 27 38.2Z" fill="#3E281C" />
      <HeadLine />
      <path d="M23 26.5H29.2M34.8 26.5H41" fill="none" {...LINE} strokeWidth={2.8} />
      <Eyes y={31} />
      <path d="M28.5 41.6H35.5" fill="none" {...LINE} stroke="#F2E6DA" strokeWidth={1.8} />
    </>
  ),
  // 汤姆·德万：年轻、乱发、似笑非笑，连帽衫
  'pro-dwan': () => (
    <>
      <Body fill="#D9483B" />
      <path d="M27 50.5L26 60M37 50.5L38 60" {...LINE} strokeWidth={1.8} />
      <Neck skin={SKIN.light} />
      <Ears skin={SKIN.light} />
      <Head skin={SKIN.light} />
      <path d="M17 30C15 17 23 10.5 33 11C43 11.5 48.5 17 47 29C45.5 25.5 43.5 23.5 41.5 22.5L39 26L36.5 21.5L31.5 25L29.5 20.5L24.5 24L21.5 22.5C19.5 25 18 27.5 17 30Z" fill="#6B4A2F" {...LINE} />
      <Brows y={26.5} tilt={-0.6} />
      <Eyes />
      <Nose />
      {MOUTH.smirk}
    </>
  ),
  // 菲尔·赫尔穆斯：招牌棒球帽 + 包裹式墨镜，嘴角一撇
  'pro-hellmuth': () => (
    <>
      <Body fill="#3A3D4A" />
      <Collar />
      <Neck skin={SKIN.fair} />
      <Ears skin={SKIN.fair} />
      <Head skin={SKIN.fair} />
      <path d="M16.5 25.5C16.5 14.5 23 9 32 9C41 9 47.5 14.5 47.5 25.5Z" fill="#7C3AED" {...LINE} />
      <path d="M13.5 25.5H50.5C50.5 28.5 45 29.5 32 29.5C19 29.5 13.5 28.5 13.5 25.5Z" fill="#5B21B6" {...LINE} />
      <path d="M29 17.5H35" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
      <Shades />
      {MOUTH.frown}
    </>
  ),
  // 丹尼尔·内格里诺：标志性的露齿大笑、短发
  'pro-negreanu': () => (
    <>
      <Body fill="#14B8A6" />
      <Collar />
      <Neck skin={SKIN.light} />
      <Ears skin={SKIN.light} />
      <Head skin={SKIN.light} />
      <path d="M17.5 30C16 18 23 12.5 32 12.5C41 12.5 48 18 46.5 30C44.5 24.5 40 21.5 33 21.5C30 21.5 27.5 20 26 18.5C23.5 22 20 25 17.5 30Z" fill="#3B2A20" {...LINE} />
      <Brows y={26} tilt={0.6} />
      <path d="M24.2 31.8Q26.5 29.4 28.8 31.8M35.2 31.8Q37.5 29.4 39.8 31.8" fill="none" {...LINE} />
      <Blush />
      {MOUTH.grin}
    </>
  ),
  // 道尔·布朗森：德州教父的牛仔帽、白发眼镜、圆脸
  'pro-brunson': () => (
    <>
      <Body fill="#B45309" />
      <Collar />
      <Neck skin={SKIN.warm} />
      <Ears skin={SKIN.warm} />
      <Head skin={SKIN.warm} />
      <path d="M17.6 25C16.8 29 17 32 18 35L21 33.5C20.5 31 20.6 28 21.2 25.5Z" fill="#F2F0EA" {...LINE} strokeWidth={2} />
      <path d="M46.4 25C47.2 29 47 32 46 35L43 33.5C43.5 31 43.4 28 42.8 25.5Z" fill="#F2F0EA" {...LINE} strokeWidth={2} />
      <path d="M18 26C18 17 21 7.5 26 7.5C29 7.5 30 9.8 32 9.8C34 9.8 35 7.5 38 7.5C43 7.5 46 17 46 26Z" fill="#C9A36B" {...LINE} />
      <path d="M18.6 20.5H45.4" stroke="#6B4423" strokeWidth={3.4} />
      <path d="M3 22.5C9 26.5 19 27.5 32 27.5C45 27.5 55 26.5 61 22.5C59.5 29 48 31.5 32 31.5C16 31.5 4.5 29 3 22.5Z" fill="#C9A36B" {...LINE} />
      <RoundGlasses r={4.4} />
      <Eyes y={32.5} r={1.8} />
      <path d="M26 38.6Q32 36.2 38 38.6Q35.5 40.6 32 39.6Q28.5 40.6 26 38.6Z" fill="#F2F0EA" {...LINE} strokeWidth={1.8} />
      {MOUTH.small}
    </>
  ),
  // 维克多·布洛姆（Isildur1）：线上横空出世的瑞典少年，金发、耳机、连帽衫
  'pro-isildur': () => (
    <>
      <Body fill="#0EA5E9" />
      <path d="M27 50.5L26 60M37 50.5L38 60" {...LINE} strokeWidth={1.8} />
      <Neck skin={SKIN.fair} />
      <Ears skin={SKIN.fair} />
      <Head skin={SKIN.fair} />
      <path d="M17.5 30C15.5 18 22 11.5 31 11.5C41 11.5 48 17 46.5 29.5C44 25 40.5 23.2 37 22.8C38 25 37.5 26.5 37 27C34.5 24 30 22.8 25 23.2C22 24.5 19.5 27 17.5 30Z" fill="#F2D06B" {...LINE} />
      <path d="M13.5 33C13.5 16 21.5 8 32 8C42.5 8 50.5 16 50.5 33" fill="none" {...LINE} strokeWidth={3.4} />
      <rect x="10.5" y="27" width="7.5" height="12" rx="3.5" fill="#2C2E2A" {...LINE} />
      <rect x="46" y="27" width="7.5" height="12" rx="3.5" fill="#2C2E2A" {...LINE} />
      <Eyes y={32} />
      {MOUTH.small}
    </>
  ),
  // 强尼·陈："东方快车"，侧分黑发、西装，桌边永远摆着一只橙子
  'pro-chan': () => (
    <>
      <Body fill="#1F2933" />
      <Collar />
      <Neck skin={SKIN.warm} />
      <Ears skin={SKIN.warm} />
      <Head skin={SKIN.warm} />
      <path d="M17.5 30C16 17.5 23 12 32 12C41 12 48 17.5 46.5 30C45.5 25 43.5 22 40.5 21C35 22.5 28 22 24.5 19.5C22.5 22 19.5 25.5 17.5 30Z" fill="#1E1E22" {...LINE} />
      <Brows y={26} tilt={0.4} />
      <Eyes />
      <Nose />
      {MOUTH.smirk}
      <circle cx="51" cy="54" r="8.5" fill="#F39A2B" {...LINE} />
      <path d="M51 45.5Q55 43 57.5 45.5Q54 48 51 45.5Z" fill="#3E9B4F" {...LINE} strokeWidth={1.8} />
      <circle cx="48" cy="51.5" r="1.4" fill="#FFFFFF" opacity="0.7" />
    </>
  ),
  // 斯图·昂格尔：标志性的蘑菇头和有色圆框眼镜，瘦削的少年天才
  'pro-ungar': () => (
    <>
      <Body fill="#E11D48" />
      <Collar />
      <Neck skin={SKIN.fair} />
      <Ears skin={SKIN.fair} />
      <Head skin={SKIN.fair} />
      <path d="M16.5 34C14.5 18.5 22.5 11 32 11C41.5 11 49.5 18.5 47.5 34L44.6 33.5C44.2 29 43.2 26.6 42 25.6H22C20.8 26.6 19.8 29 19.4 33.5Z" fill="#4A3426" {...LINE} />
      <RoundGlasses fill="#6D8FD4" opacity={0.85} r={5} />
      <circle cx="25" cy="30" r="1.2" fill="#FFFFFF" opacity="0.8" />
      <circle cx="36" cy="30" r="1.2" fill="#FFFFFF" opacity="0.8" />
      {MOUTH.small}
    </>
  ),

  // —— 风格桌 ——

  // 教授：地中海灰发、圆眼镜、领结、粗花呢外套
  'ai-prof': () => (
    <>
      <Body fill="#8B6A4E" />
      <path d="M25 50L32 55.5L39 50" fill="#FFFFFF" {...LINE} strokeWidth={2} />
      <path d="M27.5 55L32 57.5L36.5 55L36.5 60.5L32 58L27.5 60.5Z" fill="#3B82F6" {...LINE} strokeWidth={1.8} />
      <Neck skin={SKIN.light} />
      <Ears skin={SKIN.light} />
      <Head skin={SKIN.light} />
      <path d="M17.8 33C16.5 25 18 19.5 22 16.5L24.5 22.5C21.8 24.5 20.6 28 20.4 33Z" fill="#C9C6BE" {...LINE} strokeWidth={2} />
      <path d="M46.2 33C47.5 25 46 19.5 42 16.5L39.5 22.5C42.2 24.5 43.4 28 43.6 33Z" fill="#C9C6BE" {...LINE} strokeWidth={2} />
      <path d="M27 16.2Q32 14.2 37 16.2" fill="none" {...LINE} strokeWidth={1.8} />
      <RoundGlasses />
      <Eyes y={31.5} r={1.8} />
      <path d="M27 38.2Q32 35.8 37 38.2Q34.5 40.2 32 39.2Q29.5 40.2 27 38.2Z" fill="#C9C6BE" {...LINE} strokeWidth={1.8} />
      {MOUTH.small}
    </>
  ),
  // 狼哥：大背头、胡茬、挑眉坏笑，皮夹克
  'ai-wolf': () => (
    <>
      <Body fill="#2B2B2E" />
      <path d="M22 51L29 60L26 51.5M42 51L35 60L38 51.5" fill="#45454A" {...LINE} strokeWidth={1.8} />
      <Neck skin={SKIN.warm} />
      <Ears skin={SKIN.warm} />
      <Head skin={SKIN.warm} stroke={false} />
      <path d="M18.4 35C19.5 43.5 25 47 32 47C39 47 44.5 43.5 45.6 35C43 40.5 38 42.6 32 42.6C26 42.6 21 40.5 18.4 35Z" fill="#7A5A44" opacity="0.4" />
      <HeadLine />
      <path d="M17.5 29C16.5 16.5 23 11.5 32 11.5C41 11.5 47.5 16.5 46.5 29C45.5 23 43.5 20 40 18.8C36 17.6 29 17.6 25 19.4C21.5 21 19 24 17.5 29Z" fill="#1E1E22" {...LINE} />
      <path d="M26 15.5Q32 13.5 38.5 15.8" fill="none" stroke="#5B5B63" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M23.5 26.5L29 27M35 26.5L40.5 24.5" fill="none" {...LINE} />
      <Eyes />
      <Nose />
      {MOUTH.smirk}
    </>
  ),
  // 石头：锃亮光头、一字浓眉、面无表情，高领毛衣
  'ai-rock': () => (
    <>
      <Body fill="#8A8F98" />
      <path d="M24 50.5Q32 55 40 50.5V54Q32 58.5 24 54Z" fill="#9EA3AB" {...LINE} strokeWidth={2} />
      <Ears skin={SKIN.tan} />
      <Head skin={SKIN.tan} />
      <path d="M23 19Q26.5 16.5 30.5 16.4" fill="none" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" opacity="0.7" />
      <path d="M22.5 26.5H29.5M34.5 26.5H41.5" fill="none" {...LINE} strokeWidth={3.4} />
      <Eyes y={31} />
      <Nose />
      {MOUTH.flat}
    </>
  ),
  // 牛姐：烫卷发、耳环、大笑，什么牌都愿意跟
  'ai-cow': () => (
    <>
      <Body fill="#EC4899" />
      <g stroke={INK} strokeWidth={4.8}>
        {CURLS.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#7A4A2E" />)}
      </g>
      <g>
        {CURLS.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#7A4A2E" />)}
      </g>
      <Neck skin={SKIN.light} />
      <Head skin={SKIN.light} />
      <path d="M18.5 26C20 18 25 15.5 30 17C31 14.5 35 14 37.5 16.5C42 16 45.5 20.5 45.5 26C42 21.5 37 20.5 32 21C26 21.5 21.5 22.5 18.5 26Z" fill="#7A4A2E" {...LINE} strokeWidth={2} />
      <circle cx="18" cy="39" r="2.4" fill="#FFD23F" {...LINE} strokeWidth={1.6} />
      <circle cx="46" cy="39" r="2.4" fill="#FFD23F" {...LINE} strokeWidth={1.6} />
      <path d="M24.2 31.8Q26.5 29.4 28.8 31.8M35.2 31.8Q37.5 29.4 39.8 31.8" fill="none" {...LINE} />
      <Blush />
      {MOUTH.grin}
    </>
  ),
  // 疯子李：冲天乱发、瞪大双眼、张嘴狂笑
  'ai-mad': () => (
    <>
      <Body fill="#A855F7" />
      <path d="M20 54L24 60M30 52L31 61M40 53L37 60" stroke="#FFD23F" strokeWidth={2.2} strokeLinecap="round" />
      <Neck skin={SKIN.light} />
      <Ears skin={SKIN.light} />
      <Head skin={SKIN.light} />
      <path d="M17 30L12.5 21.5L19 21L15.5 11.5L24 14.5L24.5 5L31 12.5L36.5 4.5L39 13L46.5 7.5L46 17L52.5 18L47 30C45 24 40 21 32 21C24 21 19 24 17 30Z" fill="#5B2C8F" {...LINE} />
      <circle cx="26" cy="31" r="4" fill="#FFFFFF" {...LINE} strokeWidth={2} />
      <circle cx="38" cy="31" r="4" fill="#FFFFFF" {...LINE} strokeWidth={2} />
      <circle cx="26.8" cy="31.4" r="1.7" fill={INK} />
      <circle cx="37.2" cy="31.4" r="1.7" fill={INK} />
      <path d="M22 25L28.5 23.5M35.5 23.5L42 25" fill="none" {...LINE} />
      {MOUTH.open}
    </>
  ),
  // 静静：黑长直、齐刘海、安静的浅笑
  'ai-jing': () => (
    <>
      <Body fill="#3B82F6" />
      <path d="M14.5 31C14.5 15.5 22 11 32 11C42 11 49.5 15.5 49.5 31L51 58H13Z" fill="#1E1E22" {...LINE} />
      <Neck skin={SKIN.fair} />
      <Head skin={SKIN.fair} />
      <path d="M17.6 29C17 18 23.5 13 32 13C40.5 13 47 18 46.4 29C45.5 26.5 44.6 24.5 43.5 23.5H20.5C19.4 24.5 18.5 26.5 17.6 29Z" fill="#1E1E22" {...LINE} />
      <path d="M24.2 31.4Q26.5 33.4 28.8 31.4M35.2 31.4Q37.5 33.4 39.8 31.4" fill="none" {...LINE} />
      <Blush />
      {MOUTH.small}
    </>
  ),
  // 阿豪：油头侧剃、墨镜推在头顶、金链子
  'ai-hao': () => (
    <>
      <Body fill="#F59E0B" />
      <path d="M24.5 51Q32 58 39.5 51" fill="none" stroke="#FFD23F" strokeWidth={2.6} strokeLinecap="round" />
      <path d="M24.5 51Q32 58 39.5 51" fill="none" stroke={INK} strokeWidth={0.8} strokeDasharray="1.6 1.6" />
      <Neck skin={SKIN.warm} />
      <Ears skin={SKIN.warm} />
      <Head skin={SKIN.warm} />
      <path d="M18 28C18.5 24 19.5 21.5 21.5 19.5L22.5 27Z" fill="#6E6E74" opacity="0.5" />
      <path d="M46 28C45.5 24 44.5 21.5 42.5 19.5L41.5 27Z" fill="#6E6E74" opacity="0.5" />
      <path d="M19 24C18 15 24 9.5 34 9.5C43 9.5 48 14 47 21C44.5 19 41 18.6 36.5 19.2C30.5 20 24.5 21.5 19 24Z" fill="#1E1E22" {...LINE} />
      <path d="M20 18.5H44V20.6C44 23 42 24.2 39.4 24.2C37 24.2 35.2 22.8 33.8 21H30.2C28.8 22.8 27 24.2 24.6 24.2C22 24.2 20 23 20 20.6Z" fill="#F07A2E" {...LINE} strokeWidth={1.8} />
      <path d="M23 20.4H26M37 20.4H40" stroke="#FFFFFF" strokeWidth={1.4} strokeLinecap="round" opacity="0.85" />
      <Brows y={27.5} tilt={0.5} />
      <Eyes y={32} />
      <Nose />
      {MOUTH.grin}
    </>
  ),
  // 铁柱：板寸、方下巴、粗脖子，憨厚老实
  'ai-tie': () => (
    <>
      <Body fill="#6B7280" />
      <path d="M24.5 49.5Q32 56 39.5 49.5" fill="none" {...LINE} strokeWidth={2} />
      <path d="M24.5 40V50.5Q32 55 39.5 50.5V40Z" fill={SKIN.tan} {...LINE} />
      <Ears skin={SKIN.tan} />
      <path d="M18 28C18 18.5 24 14 32 14C40 14 46 18.5 46 28V36C46 43.5 40.5 48 32 48C23.5 48 18 43.5 18 36Z" fill={SKIN.tan} {...LINE} />
      <path d="M18 27C18 18 22.5 13 32 13C41.5 13 46 18 46 27C41.5 22.8 22.5 22.8 18 27Z" fill="#2A2A2E" {...LINE} />
      <path d="M22.5 27.5H29.5M34.5 27.5H41.5" fill="none" {...LINE} strokeWidth={3.2} />
      <Eyes y={32} />
      <Nose />
      {MOUTH.smile}
    </>
  ),

  human: () => (
    <>
      <Body fill={HUMAN_COLOR} />
      <Neck skin={SKIN.light} />
      <Ears skin={SKIN.light} />
      <Head skin={SKIN.light} />
      <path d="M17.5 30C16 18 23 12.5 32 12.5C41 12.5 48 18 46.5 30C44 24 39 21.5 32 21.5C25 21.5 20 24 17.5 30Z" fill="#3B3B40" {...LINE} />
      <Eyes />
      {MOUTH.smile}
    </>
  ),
}

const CURLS: [number, number, number][] = [
  [16, 38, 5.5],
  [14.5, 29, 6],
  [17.5, 19.5, 6.5],
  [25, 13, 6.5],
  [34, 11.5, 6.5],
  [42.5, 15, 6.5],
  [47.5, 23, 6],
  [49, 32, 5.5],
  [48, 40, 5],
]

// 未登记的角色（旧存档等）按性格落到风格桌的代表形象
const BY_STYLE: Record<AiStyleId, string> = {
  tag: 'ai-prof',
  lag: 'ai-wolf',
  rock: 'ai-rock',
  station: 'ai-cow',
  maniac: 'ai-mad',
  ivey: 'pro-ivey',
  dwan: 'pro-dwan',
  hellmuth: 'pro-hellmuth',
  negreanu: 'pro-negreanu',
  brunson: 'pro-brunson',
  isildur: 'pro-isildur',
  chan: 'pro-chan',
  ungar: 'pro-ungar',
}

function faceOf(playerId: string, style: AiStyleId | 'human'): Face {
  if (style === 'human') return FACES.human
  return FACES[playerId] ?? FACES[BY_STYLE[style]]
}

/** 头像本体：铺满父容器，由父容器负责圆形裁切与色环 */
export function Avatar({ playerId, style }: { playerId: string; style: AiStyleId | 'human' }) {
  return (
    <svg className="avatar" viewBox="0 0 64 64" aria-hidden>
      {faceOf(playerId, style)()}
    </svg>
  )
}

/** 行内小头像（大厅阵容、结算表、复盘对手切换），自带圆框与性格色环 */
export function AvatarChip({ playerId, style }: { playerId: string; style: AiStyleId | 'human' }) {
  const color = style === 'human' ? HUMAN_COLOR : STYLES[style].color
  return (
    <span className="avatar-chip" style={{ borderColor: color, background: `${color}24` }}>
      <Avatar playerId={playerId} style={style} />
    </span>
  )
}
