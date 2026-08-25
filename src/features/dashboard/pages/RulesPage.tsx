import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2, VolumeX, X } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SelectField } from '../components/SelectField'
import { Switch } from '../components/Switch'
import type { AppConfig, NotifyCenterEntry, NotifyRule, SaveConfig } from '../types'

interface SessionOption {
  id: string
  label: string
  type: string
}

function buildSessionOptions(entries: NotifyCenterEntry[]): SessionOption[] {
  const sessions = new Map<string, SessionOption>()
  for (const entry of entries) {
    const id = String(entry.payload.sessionId || '').trim()
    if (!id || sessions.has(id)) continue
    sessions.set(id, {
      id,
      label: entry.payload.groupName || entry.payload.sourceName || '未知会话',
      type: entry.payload.sessionType === 'group' ? '群聊' : entry.payload.sessionType === 'official' ? '公众号' : '私聊'
    })
  }
  return Array.from(sessions.values())
}

function createRule(): NotifyRule {
  return { id: 'rule_' + Date.now(), name: '', enabled: true, muted: true, sessionIds: [], keywords: [], matchMode: 'any' }
}

function SessionPicker({ sessions, selected, onToggle }: { sessions: SessionOption[]; selected: string[]; onToggle: (id: string) => void }) {
  return <div className="session-picker" role="group" aria-label="选择会话">
    {sessions.length ? sessions.map((session) => <button type="button" key={session.id} className={selected.includes(session.id) ? 'selected' : ''} aria-pressed={selected.includes(session.id)} onClick={() => onToggle(session.id)}><span>{session.label}</span><small>{session.type}</small></button>) : <span className="session-picker-empty">暂无可选会话</span>}
  </div>
}

function RuleEditor({ rule, sessions, onSave, onCancel }: { rule: NotifyRule | null; sessions: SessionOption[]; onSave: (rule: NotifyRule) => Promise<boolean>; onCancel: () => void }) {
  const [draft, setDraft] = useState<NotifyRule>(() => ({ ...(rule || createRule()), muted: true }))
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<NotifyRule>) => setDraft((value) => ({ ...value, ...patch }))
  const canSave = Boolean(draft.name.trim() && (draft.keywords.length || draft.sessionIds.length))
  const toggleSession = (id: string) => set({ sessionIds: draft.sessionIds.includes(id) ? draft.sessionIds.filter((value) => value !== id) : [...draft.sessionIds, id] })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, saving])

  const submit = async () => {
    if (!canSave || saving) return
    setSaving(true)
    const success = await onSave({ ...draft, muted: true })
    if (!success) setSaving(false)
  }

  return <><button type="button" className="side-editor-mask" aria-label="关闭规则编辑器" onClick={() => { if (!saving) onCancel() }} />
    <aside className="side-editor" role="dialog" aria-modal="true" aria-label={rule ? '编辑静音规则' : '新增静音规则'}>
      <form className="side-editor-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div className="side-editor-head"><div><b>{rule ? '编辑静音规则' : '新增静音规则'}</b></div><button type="button" className="icon-button" disabled={saving} onClick={onCancel} aria-label="关闭规则编辑器" title="关闭"><X size={16} /></button></div>
        <div className="editor-fields">
          <label htmlFor="rule-name">规则名称</label><input id="rule-name" autoFocus value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder="例如：屏蔽促销消息" />
          <label htmlFor="rule-keywords">关键词（可选）</label><input id="rule-keywords" value={draft.keywords.join(', ')} onChange={(event) => set({ keywords: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} placeholder="广告, 优惠" />
          <label>会话（可选）</label><SessionPicker sessions={sessions} selected={draft.sessionIds} onToggle={toggleSession} />
          <label htmlFor="rule-mode">匹配方式</label><SelectField id="rule-mode" label="匹配方式" value={draft.matchMode} options={[{ value: 'any', label: '满足任一条件' }, { value: 'all', label: '同时满足全部条件' }]} onChange={(value) => set({ matchMode: value as NotifyRule['matchMode'] })} />
          <div className="inline-setting"><div><b>立即启用</b></div><Switch checked={draft.enabled} onChange={(enabled) => set({ enabled })} label="立即启用此静音规则" /></div>
        </div>
        <div className="side-editor-actions"><button type="submit" className="button primary" disabled={!canSave || saving}>{saving ? '正在保存' : '保存'}</button><button type="button" className="button" disabled={saving} onClick={onCancel}>取消</button></div>
      </form>
    </aside></>
}

export function RulesPage({ config, entries, saveConfig }: { config: AppConfig; entries: NotifyCenterEntry[]; saveConfig: SaveConfig }) {
  const rules = config.notifyRules
  const sessions = useMemo(() => buildSessionOptions(entries), [entries])
  const [editor, setEditor] = useState<NotifyRule | null | false>(false)
  const [deleteRule, setDeleteRule] = useState<NotifyRule | null>(null)
  const [deleting, setDeleting] = useState(false)

  const saveRule = async (rule: NotifyRule): Promise<boolean> => {
    const next = rules.some((item) => item.id === rule.id)
      ? rules.map((item) => item.id === rule.id ? { ...rule, muted: true } : item)
      : [...rules, { ...rule, muted: true }]
    const success = await saveConfig('notifyRules', next)
    if (success) setEditor(false)
    return success
  }

  const removeRule = async () => {
    if (!deleteRule || deleting) return
    setDeleting(true)
    const success = await saveConfig('notifyRules', rules.filter((rule) => rule.id !== deleteRule.id))
    setDeleting(false)
    if (success) setDeleteRule(null)
  }

  const toggleFilterSession = (id: string) => {
    const next = config.notificationFilterList.includes(id)
      ? config.notificationFilterList.filter((value) => value !== id)
      : [...config.notificationFilterList, id]
    void saveConfig('notificationFilterList', next)
  }

  return <section className="rules-page page-body">
    <div className="rules-intro"><div><span className="rules-eyebrow">QUIET HOURS</span><h2>静音规则</h2><p>让不重要的提醒自动安静下来。</p></div><div className="rules-summary"><span><b>{rules.filter((rule) => rule.enabled).length}</b>启用</span><span><b>{rules.length}</b>总规则</span></div></div>
    <section className="surface scope-panel"><div className="scope-panel-head"><div><b>通知范围</b><small>先决定哪些会话可以触发桌面通知</small></div><SelectField label="通知范围" value={config.notificationFilterMode} options={[{ value: 'all', label: '所有会话' }, { value: 'whitelist', label: '仅选中会话' }, { value: 'blacklist', label: '除选中会话外' }]} onChange={(value) => void saveConfig('notificationFilterMode', value as AppConfig['notificationFilterMode'])} /></div>{config.notificationFilterMode !== 'all' && <SessionPicker sessions={sessions} selected={config.notificationFilterList} onToggle={toggleFilterSession} />}</section>
    <div className="rules-actions"><div><span>规则列表</span><small>按关键词或会话匹配</small></div><button className="button primary" onClick={() => setEditor(null)}><Plus size={14} />新增规则</button></div>
    <div className="rules-layout"><section className="surface rule-table"><div className="table-head"><span>规则</span><span>条件</span><span>匹配</span><span>状态</span><span>范围</span><span /></div>{rules.length ? rules.map((rule) => <div className={'table-row' + (rule.enabled ? '' : ' muted')} key={rule.id}><b>{rule.name || '未命名规则'}</b><span>{rule.keywords.join('、') || '指定会话'}</span><span>{rule.matchMode === 'all' ? '全部' : '任一'}</span><Switch checked={rule.enabled} onChange={(enabled) => void saveRule({ ...rule, enabled })} label={`切换${rule.name || '规则'}`} /><span>{rule.sessionIds.length ? `${rule.sessionIds.length} 个会话` : '全部会话'}</span><div className="table-actions"><button className="icon-button" onClick={() => setEditor(rule)} aria-label={`编辑${rule.name || '规则'}`} title="编辑"><Pencil size={14} /></button><button className="icon-button danger-icon" onClick={() => setDeleteRule(rule)} aria-label={`删除${rule.name || '规则'}`} title="删除"><Trash2 size={14} /></button></div></div>) : <div className="empty-state"><VolumeX size={24} /><b>暂无静音规则</b><button className="button primary" onClick={() => setEditor(null)}><Plus size={13} />新增规则</button></div>}</section>{editor !== false && <RuleEditor key={editor?.id || 'new'} rule={editor} sessions={sessions} onSave={saveRule} onCancel={() => setEditor(false)} />}</div>
    {deleteRule && <ConfirmDialog title={`删除“${deleteRule.name}”？`} description="删除后，该规则将不再阻止匹配的桌面弹窗。" confirmLabel="删除规则" busy={deleting} onCancel={() => setDeleteRule(null)} onConfirm={() => void removeRule()} />}
  </section>
}
