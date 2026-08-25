/**
 * 主题系统：每套主题定义一组 CSS 变量，渲染层将其应用到通知卡片。
 */
export interface ThemeVars {
  /** 背景色（或渐变） */
  background: string
  /** 可选背景图（data URL 或 URL） */
  backgroundImage?: string
  /** 边框色 */
  borderColor: string
  /** 圆角 px */
  borderRadius: number
  /** 阴影 */
  boxShadow: string
  /** 主文字色 */
  colorPrimary: string
  /** 次文字色 */
  colorSecondary: string
  /** 强调色（标题下划线/关键词高亮/光边） */
  accentColor: string
  /** 毛玻璃效果 */
  backdropFilter?: string
  /** 字体 */
  fontFamily?: string
  /** 入场动画 */
  animation: 'spring' | 'fade' | 'flip' | 'pop'
  /** 是否有发光边框动画 */
  glow?: boolean
}

export interface NotificationTheme {
  id: string
  name: string
  description: string
  vars: ThemeVars
}

export const THEMES: NotificationTheme[] = [
  {
    id: 'aurora-glass',
    name: '极光毛玻璃',
    description: '半透明磨砂质感，适配深浅色',
    vars: {
      background: 'rgba(24, 26, 38, 0.72)',
      borderColor: 'rgba(255, 255, 255, 0.14)',
      borderRadius: 16,
      boxShadow: '0 12px 48px rgba(0, 0, 0, 0.35)',
      colorPrimary: '#F2F3F7',
      colorSecondary: 'rgba(242, 243, 247, 0.72)',
      accentColor: '#7C6CFF',
      backdropFilter: 'blur(24px) saturate(160%)',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      animation: 'spring',
      glow: true
    }
  },
  {
    id: 'minimal-light',
    name: '极简白',
    description: '干净的白色卡片，适合浅色桌面',
    vars: {
      background: 'rgba(255, 255, 255, 0.96)',
      borderColor: 'rgba(0, 0, 0, 0.08)',
      borderRadius: 14,
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
      colorPrimary: '#1F2329',
      colorSecondary: '#646A73',
      accentColor: '#07C160',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      animation: 'fade'
    }
  },
  {
    id: 'gradient-flow',
    name: '渐变流光',
    description: '流动渐变色卡片，醒目吸睛',
    vars: {
      background: 'linear-gradient(135deg, #667EEA 0%, #764BA2 50%, #F093FB 100%)',
      borderColor: 'rgba(255, 255, 255, 0.25)',
      borderRadius: 18,
      boxShadow: '0 12px 40px rgba(102, 126, 234, 0.45)',
      colorPrimary: '#FFFFFF',
      colorSecondary: 'rgba(255, 255, 255, 0.85)',
      accentColor: '#FFFFFF',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      animation: 'pop',
      glow: true
    }
  },
  {
    id: 'dynamic-island',
    name: '灵动胶囊',
    description: '顶部居中的胶囊形通知',
    vars: {
      background: 'rgba(20, 22, 30, 0.88)',
      borderColor: 'rgba(255, 255, 255, 0.12)',
      borderRadius: 40,
      boxShadow: '0 16px 56px rgba(0, 0, 0, 0.45)',
      colorPrimary: '#F5F6FA',
      colorSecondary: 'rgba(245, 246, 250, 0.7)',
      accentColor: '#0A84FF',
      backdropFilter: 'blur(28px)',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      animation: 'flip'
    }
  }
]

export function getTheme(themeId?: string): NotificationTheme {
  return THEMES.find((t) => t.id === themeId) || THEMES[0]
}

export function themeToCssVars(theme: NotificationTheme, accentOverride?: string): Record<string, string> {
  const v = theme.vars
  return {
    '--nt-bg': v.background,
    '--nt-bg-image': v.backgroundImage || 'none',
    '--nt-border': v.borderColor,
    '--nt-radius': v.borderRadius + 'px',
    '--nt-shadow': v.boxShadow,
    '--nt-primary': v.colorPrimary,
    '--nt-secondary': v.colorSecondary,
    '--nt-accent': accentOverride || v.accentColor,
    '--nt-backdrop': v.backdropFilter || 'none',
    '--nt-font': v.fontFamily || 'inherit'
  }
}
