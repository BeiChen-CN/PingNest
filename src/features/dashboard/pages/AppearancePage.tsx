import { AlignJustify, Bell, Combine, Eye, Layers3, MapPin, Minus, MousePointer2, Rows3, Timer, Volume2 } from 'lucide-react'
import { SelectField } from '../components/SelectField'
import { Switch } from '../components/Switch'
import type { AppConfig, SaveConfig } from '../types'

const POSITIONS: Array<AppConfig['notificationPosition'] | null> = [null, 'top-center', null, 'top-left', null, 'top-right', 'bottom-left', null, 'bottom-right']
const POSITION_LABELS: Record<AppConfig['notificationPosition'], string> = {
  'top-center': '顶部居中', 'top-left': '左上角', 'top-right': '右上角',
  'bottom-left': '左下角', 'bottom-right': '右下角'
}

const NOTIFICATION_STYLES: Array<{
  id: AppConfig['notificationStyle']
  label: string
  description: string
  icon: typeof Rows3
}> = [
  { id: 'standard', label: '清晰卡片', description: '来源、正文与状态分层', icon: Rows3 },
  { id: 'compact', label: '速览条', description: '单行密度，适合高频提醒', icon: AlignJustify },
  { id: 'layered', label: '重点卡片', description: '更醒目的内容层级', icon: Layers3 },
  { id: 'minimal', label: '文字提示', description: '去除头像，只保留核心信息', icon: Minus }
]

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Bell; title: string; description: string }) {
  return <div className="appearance-card-head"><span className="appearance-card-icon"><Icon size={16} /></span><div><h3>{title}</h3><p>{description}</p></div></div>
}

export function AppearancePage({ config, saveConfig }: { config: AppConfig; saveConfig: SaveConfig }) {
  const selectedStyle = NOTIFICATION_STYLES.find((style) => style.id === config.notificationStyle) || NOTIFICATION_STYLES[0]

  return <section className="appearance-page page-body">
    <div className="appearance-intro">
      <div className="appearance-intro-copy"><span className="appearance-eyebrow">通知呈现</span><h2>调整你的提醒方式</h2><p>让通知在正确的位置，以合适的节奏出现。</p></div>
      <div className="appearance-current"><span>当前样式</span><b>{selectedStyle.label}</b><small>{selectedStyle.description}</small></div>
    </div>

    <div className="appearance-redesign">
      <section className="surface appearance-card appearance-style-card">
        <SectionHeader icon={Bell} title="通知样式" description="选择通知弹窗的视觉层次" />
        <div className="notification-style-picker" role="radiogroup" aria-label="通知样式">
          {NOTIFICATION_STYLES.map(({ id, label, description, icon: Icon }) => <button type="button" key={id} className={config.notificationStyle === id ? 'active' : ''} role="radio" aria-checked={config.notificationStyle === id} onClick={() => void saveConfig('notificationStyle', id)}>
            <span className={`style-option-preview preview-${id}`} aria-hidden="true"><i /><i /><i /></span><span className="style-option-copy"><b>{label}</b><small>{description}</small></span><span className="style-option-icon"><Icon size={17} /></span><span className="style-option-state" aria-hidden="true" />
          </button>)}
        </div>
      </section>

      <section className="surface appearance-card appearance-position-card">
        <SectionHeader icon={MapPin} title="弹窗位置" description="选择通知出现在屏幕的哪个区域" />
        <div className="position-setting-body"><div className="position-grid" role="group" aria-label="弹窗显示位置">{POSITIONS.map((position, index) => position ? <button type="button" key={position} className={config.notificationPosition === position ? 'active' : ''} aria-label={POSITION_LABELS[position]} aria-pressed={config.notificationPosition === position} onClick={() => void saveConfig('notificationPosition', position)}><span /></button> : <i key={index} aria-hidden="true" />)}</div><div className="position-current"><span>当前显示位置</span><b>{POSITION_LABELS[config.notificationPosition]}</b><small>通知会避开主要工作区域</small></div></div>
      </section>

      <section className="surface appearance-card appearance-timing-card">
        <SectionHeader icon={Timer} title="显示参数" description="控制通知停留时间与透明度" />
        <div className="appearance-range-grid">
          <label className="appearance-range"><span><b>显示持续时间</b><em>{Math.round(config.notificationDurationMs / 1000)} 秒</em></span><input type="range" min="3000" max="15000" step="1000" value={config.notificationDurationMs} aria-label="显示持续时间" aria-valuetext={`${Math.round(config.notificationDurationMs / 1000)} 秒`} onChange={(event) => void saveConfig('notificationDurationMs', Number(event.target.value))} /><small>通知将在设定时间后自动消失</small></label>
          <label className="appearance-range"><span><b>通知透明度</b><em>{config.notificationOpacity}%</em></span><input type="range" min="70" max="100" value={config.notificationOpacity} aria-label="通知透明度" aria-valuetext={`${config.notificationOpacity}%`} onChange={(event) => void saveConfig('notificationOpacity', Number(event.target.value))} /><small>降低透明度可减少视觉干扰</small></label>
        </div>
      </section>

      <section className="surface appearance-card appearance-behavior-card">
        <SectionHeader icon={MousePointer2} title="交互行为" description="决定通知如何合并、反馈与响应" />
        <div className="appearance-setting-list">
          <div className="appearance-setting-row"><span className="setting-row-icon"><Combine size={15} /></span><div><b>合并消息</b><small>短时间内的同会话消息合并显示</small></div><Switch checked={config.mergeWindowMs > 0} onChange={(enabled) => void saveConfig('mergeWindowMs', enabled ? 3500 : 0)} label="合并消息" /></div>
          <div className="appearance-setting-row"><span className="setting-row-icon"><Eye size={15} /></span><div><b>显示摘要</b><small>在通知中显示消息正文摘要</small></div><Switch checked={config.showNotificationSummary} onChange={(enabled) => void saveConfig('showNotificationSummary', enabled)} label="显示摘要" /></div>
          <div className="appearance-setting-row"><span className="setting-row-icon"><Volume2 size={15} /></span><div><b>通知提示音</b><small>收到新通知时播放提示音</small></div><Switch checked={config.soundEnabled} onChange={(enabled) => void saveConfig('soundEnabled', enabled)} label="通知提示音" /></div>
        </div>
        <div className="appearance-click-setting"><label htmlFor="click-action">点击通知后</label><SelectField id="click-action" label="点击通知后" value={config.notifyCenterEnabled ? config.notificationClickBehavior : 'none'} disabled={!config.notifyCenterEnabled} options={[{ value: 'open-app', label: '在通知历史中查看' }, { value: 'none', label: '无操作' }]} onChange={(value) => void saveConfig('notificationClickBehavior', value as AppConfig['notificationClickBehavior'])} /></div>
      </section>
    </div>
  </section>
}
