import { CheckCircle2, Database, KeyRound, LoaderCircle, RotateCw, Trash2 } from 'lucide-react'
import { SelectField } from '../components/SelectField'
import { Switch } from '../components/Switch'
import type { AppConfig, AppStatus, HookProgress, SaveConfig } from '../types'

interface Props {
  config: AppConfig
  status: AppStatus
  hookBusy: boolean
  hookProgress: HookProgress | null
  entryCount: number
  saveConfig: SaveConfig
  onRequestClear: () => void
  onReconnect: () => void
  onRehook: () => void
  onRequestRemoveHook: () => void
}

function maskAccount(account: string): string {
  if (!account) return '未识别'
  if (account.length <= 10) return account
  return account.slice(0, 7) + '...' + account.slice(-4)
}

export function SystemSettingsPage({ config, status, hookBusy, hookProgress, entryCount, saveConfig, onRequestClear, onReconnect, onRehook, onRequestRemoveHook }: Props) {
  const retentionValue = config.autoCleanupHistory ? String(config.historyRetentionDays) : 'forever'

  const changeRetention = async (value: string) => {
    if (value === 'forever') {
      await saveConfig('autoCleanupHistory', false)
      return
    }

    const retentionSaved = await saveConfig('historyRetentionDays', Number(value))
    if (retentionSaved && !config.autoCleanupHistory) {
      await saveConfig('autoCleanupHistory', true)
    }
  }

  return <section className="settings-page page-body">
    <div className="settings-groups">
      <section className="surface setting-section hook-management">
        <div className="hook-management-copy">
          <span className="setting-leading-icon"><KeyRound size={18} /></span>
          <div><h2>微信连接</h2><span className="hook-account"><b>{status.config.myWxName || '微信账号'}</b><small>{maskAccount(status.config.myWxid)}</small></span></div>
        </div>
        <div className="hook-management-status">
          <span className="hook-ready-badge"><CheckCircle2 size={14} />{status.connected ? '已连接' : '未连接'}</span>
          {hookProgress && hookProgress.stage !== 'success' && <small className={hookProgress.stage === 'error' ? 'error' : ''}>{hookProgress.message}</small>}
        </div>
        <div className="hook-management-actions">
          <button className="md-button outlined" disabled={hookBusy || !status.wechatRunning} onClick={onReconnect} title={!status.wechatRunning ? '请先启动并登录微信' : '使用已保存凭据重新连接'}>
            {hookBusy ? <LoaderCircle className="spin" size={14} /> : <RotateCw size={14} />}{hookBusy ? '正在连接' : '重新连接'}
          </button>
          <button className="md-button outlined" disabled={hookBusy || !status.wechatRunning} onClick={onRehook} title={!status.wechatRunning ? '请先启动并登录微信' : '重新获取密钥并建立连接'}><KeyRound size={14} />重新 Hook</button>
          <button className="md-button outlined danger-action" disabled={hookBusy} onClick={onRequestRemoveHook}><Trash2 size={14} />删除连接</button>
        </div>
      </section>
      <section className="surface setting-section">
        <h2>启动与托盘</h2>
        <p className="setting-section-desc">管理应用在 Windows 中的后台行为</p>
        <div className="inline-setting"><div><b>开机启动至托盘</b><span>登录 Windows 后自动运行</span></div><Switch checked={config.startupEnabled} onChange={(enabled) => void saveConfig('startupEnabled', enabled)} label="开机启动至托盘" /></div>
        <div className="inline-setting"><div><b>关闭窗口时隐藏到托盘</b><span>关闭窗口时保持后台监听</span></div><Switch checked={config.closeToTray} onChange={(enabled) => void saveConfig('closeToTray', enabled)} label="关闭窗口时隐藏到托盘" /></div>
        <div className="inline-setting"><div><b>隐藏到托盘时显示提示</b><span>首次隐藏时弹一次系统提示</span></div><Switch checked={config.trayNotifications} disabled={!config.closeToTray} onChange={(enabled) => void saveConfig('trayNotifications', enabled)} label="隐藏到托盘时显示提示" /></div>
      </section>
      <section className="surface setting-section">
        <h2>监听与连接</h2>
        <p className="setting-section-desc">配置检测频率与断线恢复</p>
        <div className="inline-setting"><div><b>断线自动重连</b><span>WCDB 管道关闭后尝试重新连接</span></div><Switch checked={config.autoReconnect} onChange={(enabled) => void saveConfig('autoReconnect', enabled)} label="断线自动重连" /></div>
        <label className={'range-control' + (!config.autoReconnect ? ' disabled' : '')}><span><b>重连间隔</b><em>{config.reconnectIntervalSeconds} 秒</em></span><input type="range" min="1" max="15" value={config.reconnectIntervalSeconds} disabled={!config.autoReconnect} onChange={(event) => void saveConfig('reconnectIntervalSeconds', Number(event.target.value))} /></label>
      </section>
      <section className="surface setting-section">
        <h2>历史消息</h2>
        <p className="setting-section-desc">控制本机通知数据的保留范围</p>
        <div className="inline-setting"><div><b>保存通知历史</b><span>在本机记录收到的通知</span></div><Switch checked={config.notifyCenterEnabled} onChange={(enabled) => void saveConfig('notifyCenterEnabled', enabled)} label="保存通知历史" /></div>
        <div className="inline-setting retention-row"><div><b>保留期限</b><span>自动清理超过期限的记录</span></div><SelectField id="retention" label="保留期限" value={retentionValue} options={[{ value: 'forever', label: '永久保存' }, { value: '7', label: '保留 7 天' }, { value: '30', label: '保留 30 天' }, { value: '90', label: '保留 90 天' }]} onChange={(value) => void changeRetention(value)} /></div>
      </section>
      <section className="surface setting-section">
        <h2>数据与隐私</h2>
        <p className="setting-section-desc">所有记录仅保存在当前设备</p>
        <div className="data-summary"><Database size={16} /><div><span>本地通知数据</span><b>已保存 {entryCount} 条</b></div></div>
        <button className="md-button outlined danger-action" disabled={!entryCount} onClick={onRequestClear}><Trash2 size={14} />清空通知历史</button>
      </section>
    </div>
  </section>
}
