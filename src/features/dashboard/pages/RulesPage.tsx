import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Switch } from '../components/Switch'
import type { AppConfig, NotifyCenterEntry, NotifyRule, SaveConfig } from '../types'

interface Props {
  config: AppConfig
  entries: NotifyCenterEntry[]
  saveConfig: SaveConfig
}

function createRule(): NotifyRule {
  return { id: 'rule_' + Date.now(), name: '', enabled: true, muted: true, sessionIds: [], keywords: [], matchMode: 'any' }
}

/** 静音规则：规则卡 + 内联编辑器。muted 恒为 true（本页规则只静音不弹窗）。 */
export function RulesPage({ config, entries, saveConfig }: Props) {
  const rules = config.notifyRules
  const [editing, setEditing] = useState<NotifyRule | null>(null)
  const [keywordDraft, setKeywordDraft] = useState('')

  const sessions = useMemoSessions(entries)

  const startCreate = () => {
    setKeywordDraft('')
    setEditing(createRule())
  }
  const startEdit = (rule: NotifyRule) => {
    setKeywordDraft(rule.keywords.join(', '))
    setEditing({ ...rule })
  }

  const save = async () => {
    if (!editing) return
    const keywords = keywordDraft.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
    const next = rules.some((rule) => rule.id === editing.id)
      ? rules.map((rule) => rule.id === editing.id ? { ...editing, keywords, muted: true } : rule)
      : [...rules, { ...editing, keywords, muted: true }]
    if (await saveConfig('notifyRules', next)) setEditing(null)
  }

  const toggleRule = (rule: NotifyRule, enabled: boolean) => {
    void saveConfig('notifyRules', rules.map((item) => item.id === rule.id ? { ...item, enabled } : item))
  }
  const deleteRule = (rule: NotifyRule) => {
    void saveConfig('notifyRules', rules.filter((item) => item.id !== rule.id))
  }

  return <section className="rules-page">
    {editing && <div className="rule-editor card">
      <div className="re-head"><b>{rules.some((rule) => rule.id === editing.id) ? '编辑规则' : '新建规则'}</b>
        <button className="icon-button" onClick={() => setEditing(null)} aria-label="取消编辑"><Plus size={14} style={{ transform: 'rotate(45deg)' }} /></button></div>
      <label className="re-field"><span>规则名称</span>
        <input value={editing.name} placeholder="例如：广告关键词" onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
      <label className="re-field"><span>关键词（逗号分隔，可选）</span>
        <input value={keywordDraft} placeholder="广告, 优惠, 促销" onChange={(event) => setKeywordDraft(event.target.value)} /></label>
      <div className="re-field"><span>匹配方式</span>
        <div className="segf">
          <button className={editing.matchMode === 'any' ? 'on' : ''} onClick={() => setEditing({ ...editing, matchMode: 'any' })}>满足任一</button>
          <button className={editing.matchMode === 'all' ? 'on' : ''} onClick={() => setEditing({ ...editing, matchMode: 'all' })}>同时满足全部</button>
        </div></div>
      {sessions.length > 0 && <div className="re-field"><span>限定会话（可选）</span>
        <div className="re-sessions">
          {sessions.map((session) => {
            const picked = editing.sessionIds.includes(session.id)
            return <button key={session.id} className={'chip' + (picked ? '' : ' gray')}
              onClick={() => setEditing({ ...editing, sessionIds: picked ? editing.sessionIds.filter((id) => id !== session.id) : [...editing.sessionIds, session.id] })}>
              {session.name}
            </button>
          })}
        </div></div>}
      <div className="re-foot">
        <button className="md-button outlined" onClick={() => setEditing(null)}>取消</button>
        <button className="md-button filled" disabled={!editing.name.trim() || (!keywordDraft && editing.sessionIds.length === 0)} onClick={() => void save()}>保存规则</button>
      </div>
    </div>}

    <div className="rules-grid">
      {rules.map((rule) => <div key={rule.id} className={'bx rule-card' + (rule.enabled ? '' : ' off')}>
        <div className="rc-head">
          <b>{rule.name}</b>
          <span className={'chip' + (rule.enabled ? '' : ' warn')}>{rule.enabled ? '生效中' : '已停用'}</span>
          <span style={{ marginLeft: 'auto' }}><Switch checked={rule.enabled} onChange={(enabled) => toggleRule(rule, enabled)} label={`启用 ${rule.name}`} /></span>
        </div>
        <div className="sub">{rule.matchMode === 'all' ? '同时满足全部条件' : '满足任一条件即静音'}</div>
        {rule.keywords.length > 0 && <div className="chiprow">{rule.keywords.map((keyword) => <span key={keyword} className="chip">{keyword}</span>)}</div>}
        {rule.sessionIds.length > 0 && <div className="sub" style={{ marginTop: 8 }}>限定 {rule.sessionIds.length} 个会话</div>}
        <div className="rc-foot">
          <button className="md-button outlined sm" onClick={() => startEdit(rule)}>编辑</button>
          <button className="md-button danger-action sm" onClick={() => deleteRule(rule)}><Trash2 size={13} />删除</button>
        </div>
      </div>)}
      <button className="bx rule-add" onClick={startCreate}><Plus size={18} />新建一条规则</button>
    </div>
  </section>
}

/** 从历史记录提取可选会话（去重，取名字非空的） */
function useMemoSessions(entries: NotifyCenterEntry[]): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>()
  for (const entry of entries) {
    const id = String(entry.payload.sessionId || '')
    if (!id || seen.has(id)) continue
    const name = String(entry.payload.groupName || entry.payload.sourceName || id)
    seen.set(id, name)
  }
  return Array.from(seen, ([id, name]) => ({ id, name })).slice(0, 24)
}
