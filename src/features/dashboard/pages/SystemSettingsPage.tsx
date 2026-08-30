import { KeyRound, RotateCw, Trash2 } from 'lucide-react'
import { Switch } from '../components/Switch'
import type { AppConfig, AppStatus, HookProgress, SaveConfig } from '../types'

interface Props {
  config: AppConfig
  status: AppStatus
  hookBusy: boolean
  hookProgress: HookProgress | null
  entryCount: number
  saveConfig: SaveConfig
  onReconnect: () => void
  onRehook: () => void
  onRequestRemoveHook: () => void
}

function maskAccount(account: string): string {
  if (!account) return '未识别'
  if (account.length <= 10) return account
  return account.slice(0, 7) + '...' + account.slice(-4)
}

export function SystemSettingsPage({ config, status, hookBusy, hookProgress, entryCount, saveConfig, onReconnect, onRehook, onRequestRemoveHook }: Props) {
  const retentionValue = config.autoCleanupHistory ? String(config.historyRetentionDays) : 'forever'

  const changeRetention = async (value: string) => {
    if (value === 'forever') {
      await saveConfig('autoCleanupHistory', false)
      return
    }
    const saved = await saveConfig('historyRetentionDays', Number(value))
    if (saved && !config.autoCleanupHistory) await saveConfig('autoCleanupHistory', true)
  }

  return <section className="settings-page">
    <div className="set-grid">
      <div className="bx">
        <h4>微信连接</h4>
        <div className="kv2"><span>账号</span><b>{status.config.myWxName || '未识别'}</b></div>
        <div className="kv2"><span>wxid</span><b>{maskAccount(status.config.myWxid)}</b></div>
        <div className="kv2"><span>状态</span><b style={status.connected ? { color: 'var(--brand-deep)' } : undefined}>{status.connected ? '已连接' : '未连接'}</b></div>
        {hookProgress && hookProgress.stage !== 'success' && <div className="sub" style={{ marginTop: 8 }}>{hookProgress.message}</div>}
        <div className="re-foot">
          <button className="md-button outlined sm" disabled={hookBusy || !status.wechatRunning} onClick={onReconnect} title={status.wechatRunning ? '使用已保存凭据重新连接' : '请先启动并登录微信'}><RotateCw size={13} />重新连接</button>
          <button className="md-button outlined sm" disabled={hookBusy || !status.wechatRunning} onClick={onRehook} title="重新获取密钥并建立连接"><KeyRound size={13} />重新 Hook</button>
          <button className="md-button danger-action sm" disabled={hookBusy} onClick={onRequestRemoveHook}><Trash2 size={13} />删除连接</button>
        </div>
      </div>

      <div className="bx">
        <h4>启动与托盘</h4>
        <div className="srow"><div className="st"><b>开机启动</b><span>登录后运行至托盘</span></div><Switch checked={config.startupEnabled} onChange={(enabled) => void saveConfig('startupEnabled', enabled)} label="开机启动" /></div>
        <div className="srow"><div className="st"><b>关闭时隐藏到托盘</b><span>后台保持监听</span></div><Switch checked={config.closeToTray} onChange={(enabled) => void saveConfig('closeToTray', enabled)} label="关闭时隐藏到托盘" /></div>
        <div className="srow"><div className="st"><b>隐藏时系统提示</b><span>首次隐藏提醒一次</span></div><Switch checked={config.trayNotifications} disabled={!config.closeToTray} onChange={(enabled) => void saveConfig('trayNotifications', enabled)} label="隐藏时系统提示" /></div>
      </div>

      <div className="bx">
        <h4>监听与连接</h4>
        <div className="srow"><div className="st"><b>断线自动重连</b><span>连接中断后自动恢复</span></div><Switch checked={config.autoReconnect} onChange={(enabled) => void saveConfig('autoReconnect', enabled)} label="断线自动重连" /></div>
        <div className="rg"><span>重连间隔</span><input type="range" min="1" max="15" value={config.reconnectIntervalSeconds} disabled={!config.autoReconnect} onChange={(event) => void saveConfig('reconnectIntervalSeconds', Number(event.target.value))} /><em>{config.reconnectIntervalSeconds} 秒</em></div>
        <div className="rg"><span>轮询间隔</span><input type="range" min="1" max="15" value={config.pollIntervalSeconds} onChange={(event) => void saveConfig('pollIntervalSeconds', Number(event.target.value))} /><em>{config.pollIntervalSeconds} 秒</em></div>
      </div>

      <div className="bx">
        <h4>数据与隐私</h4>
        <div className="srow"><div className="st"><b>保存通知历史</b><span>在本机记录收到的通知</span></div><Switch checked={config.notifyCenterEnabled} onChange={(enabled) => void saveConfig('notifyCenterEnabled', enabled)} label="保存通知历史" /></div>
        <div className="rg"><span style={{ flex: '0 0 64px' }}>保留期限</span>
          <div className="segf">
            {[{ v: '7', l: '7 天' }, { v: '30', l: '30 天' }, { v: '90', l: '90 天' }, { v: 'forever', l: '永久' }].map((option) => (
              <button key={option.v} className={retentionValue === option.v ? 'on' : ''} onClick={() => void changeRetention(option.v)}>{option.l}</button>
            ))}
          </div></div>
        <div className="kv2"><span>存储加密</span><b style={status.history?.writeEncrypted === false ? { color: 'var(--danger)' } : { color: 'var(--brand-deep)' }}>
          {status.history?.writeEncrypted === false ? '明文（系统加密不可用）' : 'safeStorage 已加密'}
        </b></div>
        {status.history?.degraded && <div className="sub" style={{ color: 'var(--danger)' }}>{status.history.reason}</div>}
        <div className="kv2"><span>本地记录</span><b>{entryCount} 条</b></div>
        {status.history?.corruptBackupAt ? <div className="sub" style={{ color: 'var(--danger)' }}>检测到历史文件损坏，原文件已备份（.corrupt-时间戳）。</div> : null}
      </div>
    </div>
  </section>
}
