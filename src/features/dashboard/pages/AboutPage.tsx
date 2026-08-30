import { BellRing, ShieldCheck, Database, LockKeyhole, GitBranch, Globe } from 'lucide-react'
import type { AppConfig, AppStatus } from '../types'

interface Props {
  config: AppConfig
  status: AppStatus
  entryCount: number
}

export function AboutPage({ config, status, entryCount }: Props) {
  const healthy = status.connected && status.wcdbReady && !status.pushError
  return <section className="about-page">
    <div className="bento">
      <div className="bx bx-hero" style={{ gridColumn: 'span 2' }}>
        <img className="about-icon" src="./icon.png" alt="PingNest 图标" />
        <h4>PINGNEST</h4>
        <div className="big">v{__APP_VERSION__}</div>
        <div className="sub" style={{ fontSize: 12.5, lineHeight: 1.9, marginTop: 10 }}>
          把重要的微信消息带到桌面，用更少的打扰换来更清晰的工作节奏。<br />
          九种通知样式 · 堆叠队列 · 静音规则 · 本地加密存储
        </div>
      </div>
      <div className="bx">
        <h4>当前状态</h4>
        <div className="kv2" style={{ marginTop: 8 }}><span>微信账号</span><b>{status.config.myWxName || '未识别'}</b></div>
        <div className="kv2"><span>消息监听</span><b style={healthy ? { color: 'var(--brand-deep)' } : undefined}>{healthy ? '正常运行' : '未连接'}</b></div>
        <div className="kv2"><span>通知历史</span><b>{config.notifyCenterEnabled ? `${entryCount} 条` : '未启用'}</b></div>
      </div>
      <div className="bx">
        <h4>本地优先</h4>
        <div className="sub" style={{ fontSize: 12, lineHeight: 2.1, marginTop: 8 }}>
          <span className="ap-line"><LockKeyhole size={12} /> 通知内容只留在这台设备</span>
          <span className="ap-line"><Database size={12} /> 本地保存通知历史</span>
          <span className="ap-line"><GitBranch size={12} /> 配置与数据独立存储</span>
          <span className="ap-line"><Globe size={12} /> 头像经微信 CDN 拉取</span>
        </div>
      </div>
      <div className="bx" style={{ gridColumn: 'span 3' }}>
        <h4>许可与致谢</h4>
        <div className="sub" style={{ marginTop: 8 }}>
          <span className="ap-line"><ShieldCheck size={12} /> CC BY-NC-SA 4.0 · 非商业使用需遵守许可条款</span>
          <span className="ap-line"><BellRing size={12} /> 感谢 WeFlow 提供思路与参考</span>
          <span className="ap-line">第三方许可清单见安装包 resources/licenses</span>
        </div>
      </div>
    </div>
  </section>
}
