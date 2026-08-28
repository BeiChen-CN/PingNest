import { BellRing, Database, GitBranch, Heart, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { AppConfig, AppStatus } from '../types'

interface Props {
  config: AppConfig
  status: AppStatus
  entryCount: number
}

export function AboutPage({ config, status, entryCount }: Props) {
  return <section className="about-page page-body">
    <div className="about-hero surface">
      <div className="about-brand-mark"><BellRing size={25} /></div>
      <div className="about-hero-copy"><span className="about-eyebrow">本地通知伴侣</span><h2>PingNest</h2><p>把重要的微信消息，安静而可靠地带到桌面。</p></div>
      <span className="about-version">v{__APP_VERSION__}</span>
    </div>

    <div className="about-grid">
      <section className="surface about-card about-principles"><div className="about-card-head"><ShieldCheck size={17} /><div><h3>本地优先</h3><p>你的通知内容只留在这台设备上。</p></div></div><div className="about-principle-list"><div><LockKeyhole size={15} /><span>不上传聊天内容</span></div><div><Database size={15} /><span>本地保存通知历史</span></div><div><GitBranch size={15} /><span>配置与数据独立存储</span></div></div></section>
      <section className="surface about-card"><div className="about-card-head"><BellRing size={17} /><div><h3>当前状态</h3><p>应用与微信连接信息</p></div></div><dl className="about-status-list"><div><dt>微信账号</dt><dd>{status.config.myWxName || '未识别'}</dd></div><div><dt>消息监听</dt><dd className={status.connected && status.wcdbReady ? 'good' : ''}>{status.connected && status.wcdbReady ? '正常运行' : '未连接'}</dd></div><div><dt>通知历史</dt><dd>{config.notifyCenterEnabled ? `${entryCount} 条` : '未启用'}</dd></div></dl></section>
      <section className="surface about-card about-features"><div className="about-card-head"><Heart size={17} /><div><h3>PingNest 的工作方式</h3><p>专注于提醒本身，不打扰你的工作流。</p></div></div><div className="about-feature-grid"><span>桌面通知</span><span>历史检索</span><span>静音规则</span><span>托盘运行</span></div></section>
    </div>
    <p className="about-footer">PingNest · 数据仅保存在本机 · 感谢你的使用</p>
  </section>
}
