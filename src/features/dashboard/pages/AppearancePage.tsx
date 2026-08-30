import {
  Activity, Disc, Hexagon, Mail, Pill, Rows3,
  ScrollText, Sparkles, Terminal, Waves
} from 'lucide-react'
import { NotificationToast } from '../../../components/NotificationToast'
import { notificationScaleFactor } from '../../../../shared/notificationMetrics'
import { MOTION_SCHEMES } from '../../../../shared/motionScheme'
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
  { id: 'capsule', label: '灵动胶囊', description: '中心展开收拢', icon: Pill },
  { id: 'tidal', label: '潮汐', description: '液态玻璃流光', icon: Waves },
  { id: 'terminal', label: '终端', description: '系统日志单行', icon: Terminal },
  { id: 'mail', label: '信笺', description: '纸纹时间邮戳', icon: Mail },
  { id: 'neon', label: '霓虹弧光', description: '旋转弧光', icon: Sparkles },
  { id: 'wave', label: '音轨', description: '信号频谱', icon: Activity },
  { id: 'hex', label: '蜂巢', description: '六边蜂室拼合', icon: Hexagon },
  { id: 'scroll', label: '卷轴', description: '热敏纸带', icon: ScrollText },
  { id: 'halo', label: '呼吸圆环', description: '倒计时圆环', icon: Disc }
]

export function AppearancePage({ config, saveConfig }: { config: AppConfig; saveConfig: SaveConfig }) {
  const selectedStyle = NOTIFICATION_STYLES.find((style) => style.id === config.notificationStyle) || NOTIFICATION_STYLES[0]

  return <section className="appearance-page">
    <div className="ap-grid">
      <div className="bx" style={{ gridColumn: 'span 2' }}>
        <h4>通知样式</h4>
        <div className="stygrid">
          {NOTIFICATION_STYLES.map(({ id, label, description, icon: Icon }) => (
            <button type="button" key={id} className={'sty' + (config.notificationStyle === id ? ' on' : '')}
              role="radio" aria-checked={config.notificationStyle === id}
              onClick={() => void saveConfig('notificationStyle', id)}>
              <span className={`spv spv-${id}`}>
                {id === 'capsule' && <><span className="d" /><i style={{ width: '34%' }} /><i style={{ width: '22%' }} /></>}
                {id === 'tidal' && <><i style={{ width: '38%' }} /><i style={{ width: '24%' }} /></>}
                {id === 'terminal' && <><i style={{ width: '30%', marginTop: 10 }} /><i style={{ width: '46%' }} /></>}
                {id === 'mail' && <><i style={{ width: '44%' }} /></>}
                {id === 'neon' && <><i style={{ width: '40%', background: '#b9b0ff', opacity: .9 }} /><i style={{ width: '24%', background: '#9fd8e8', opacity: .8 }} /></>}
                {id === 'wave' && <span className="eq"><i /><i /><i /><i /><i /></span>}
                {id === 'hex' && <span className="hex" />}
                {id === 'scroll' && <><i style={{ width: '26%' }} /><i style={{ width: '48%' }} /></>}
                {id === 'halo' && <span className="ring2" />}
              </span>
              <b>{label}<Icon size={11} style={{ marginLeft: 5, opacity: .6 }} /></b>
              <span>{description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bx">
        <h4>弹窗位置</h4>
        <div className="posgrid">
          {POSITIONS.map((position, index) => position
            ? <button type="button" key={position} className={'pos' + (config.notificationPosition === position ? ' on' : '')}
              aria-label={POSITION_LABELS[position]} onClick={() => void saveConfig('notificationPosition', position)}><i /></button>
            : <i key={index} aria-hidden="true" />)}
        </div>
        <div className="sub" style={{ marginTop: 10 }}>当前：{POSITION_LABELS[config.notificationPosition]} · 跟随光标所在屏幕</div>
        <h4 style={{ marginTop: 16 }}>实时预览</h4>
        <div className="preview-mini">
          <NotificationToast
            data={{
              id: 'appearance-preview', sessionId: 'preview', title: '张三', groupName: '产品设计群',
              content: '今晚 8 点前把方案发我，我们需要做最后评审。',
              timestamp: Math.floor(Date.now() / 1000), event: 'message.new',
              notificationStyle: config.notificationStyle, showSummary: config.showNotificationSummary,
              clickBehavior: 'none', durationMs: config.notificationDurationMs,
              opacity: config.notificationOpacity, sizeScale: notificationScaleFactor(config.notificationSize), mergeCount: 1
            }}
            onClose={() => { }} onClick={() => { }} isStatic suppressEffects position="static" />
        </div>
      </div>

      <div className="bx">
        <h4>动效风格</h4>
        <div className="rg"><span>全局动效</span>
          <div className="segf">
            {MOTION_SCHEMES.map((scheme) => (
              <button key={scheme.value} className={config.motionScheme === scheme.value ? 'on' : ''}
                onClick={() => void saveConfig('motionScheme', scheme.value)}>{scheme.label}</button>
            ))}
          </div></div>
        <div className="sub" style={{ marginTop: 8 }}>
          {MOTION_SCHEMES.find((scheme) => scheme.value === config.motionScheme)?.description} · 切换后页面会重播入场动画
        </div>
      </div>

      <div className="bx">
        <h4>尺寸与堆叠</h4>
        <div className="rg"><span>卡片大小</span>
          <div className="segf">
            {[{ v: 'large', l: '大' }, { v: 'medium', l: '中' }, { v: 'small', l: '小' }].map((option) => (
              <button key={option.v} className={config.notificationSize === option.v ? 'on' : ''}
                onClick={() => void saveConfig('notificationSize', option.v as AppConfig['notificationSize'])}>{option.l}</button>
            ))}
          </div></div>
        <div className="rg"><span>堆叠数量</span><input type="range" min="1" max="6" value={config.notificationQueueSize}
          onChange={(event) => void saveConfig('notificationQueueSize', Number(event.target.value))} /><em>{config.notificationQueueSize === 1 ? '单卡' : config.notificationQueueSize + ' 张'}</em></div>
        <div className="rg"><span>持续时间</span><input type="range" min="3000" max="15000" step="1000" value={config.notificationDurationMs}
          onChange={(event) => void saveConfig('notificationDurationMs', Number(event.target.value))} /><em>{Math.round(config.notificationDurationMs / 1000)} 秒</em></div>
        <div className="rg"><span>透明度</span><input type="range" min="70" max="100" value={config.notificationOpacity}
          onChange={(event) => void saveConfig('notificationOpacity', Number(event.target.value))} /><em>{config.notificationOpacity}%</em></div>
      </div>

      <div className="bx">
        <h4>其他</h4>
        <div className="srow"><div className="st"><b>合并消息</b><span>短时间内同会话连发折叠为一张</span></div>
          <Switch checked={config.mergeWindowMs > 0} onChange={(enabled) => void saveConfig('mergeWindowMs', enabled ? 3500 : 0)} label="合并消息" /></div>
        <div className="srow"><div className="st"><b>显示摘要</b><span>正文两行预览</span></div>
          <Switch checked={config.showNotificationSummary} onChange={(enabled) => void saveConfig('showNotificationSummary', enabled)} label="显示摘要" /></div>
        <div className="srow"><div className="st"><b>通知提示音</b><span>合成音 · 无外部资源</span></div>
          <Switch checked={config.soundEnabled} onChange={(enabled) => void saveConfig('soundEnabled', enabled)} label="通知提示音" /></div>
        <div className="re-foot" style={{ paddingTop: 10 }}>
          <div className="ap-click">
            <span>点击通知后</span>
            <div className="segf">
              {[{ v: 'open-wechat', l: '激活微信' }, { v: 'open-app', l: '看历史' }, { v: 'none', l: '无操作' }].map((option) => (
                <button key={option.v} className={config.notificationClickBehavior === option.v ? 'on' : ''}
                  onClick={() => void saveConfig('notificationClickBehavior', option.v as AppConfig['notificationClickBehavior'])}>{option.l}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
}

