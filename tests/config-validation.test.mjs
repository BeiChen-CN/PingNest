import test from 'node:test'
import assert from 'node:assert/strict'
import { validateConfigValue, validateNotifyRules } from '../electron/ipc/configRules.ts'

const KNOWN_KEYS = [
  'dbPath', 'decryptKey', 'myWxid', 'myWxName', 'onboardingDone',
  'notificationEnabled', 'soundEnabled', 'showNotificationSummary', 'notifyCenterEnabled',
  'startupEnabled', 'closeToTray', 'trayNotifications', 'autoReconnect', 'autoCleanupHistory',
  'notificationPosition', 'notificationStyle', 'notificationFilterMode', 'notificationFilterList',
  'mergeWindowMs', 'soundEnabled', 'notificationDurationMs', 'notificationOpacity',
  'notificationClickBehavior', 'notifyRules', 'reconnectIntervalSeconds', 'notificationQueueSize',
  'notificationSize', 'motionScheme', 'historyRetentionDays', 'autoCleanupHistory'
]

const validRule = {
  id: 'rule_1', name: '静音广告', enabled: true, muted: true,
  sessionIds: ['wxid_a'], keywords: ['优惠'], matchMode: 'any'
}

test('validateConfigValue：未知键被拒绝', () => {
  assert.equal(validateConfigValue('not_a_key', 1, KNOWN_KEYS), '未知配置项')
})

test('validateConfigValue：布尔键必须是布尔值', () => {
  assert.equal(validateConfigValue('notificationEnabled', 'yes', KNOWN_KEYS), '配置值必须是布尔值')
  assert.equal(validateConfigValue('notificationEnabled', true, KNOWN_KEYS), null)
})

test('validateConfigValue：连接键只接受字符串', () => {
  assert.equal(validateConfigValue('dbPath', { path: 'C:/' }, KNOWN_KEYS), '数据目录格式无效')
  assert.equal(validateConfigValue('decryptKey', 12345, KNOWN_KEYS), '连接凭据格式无效')
  assert.equal(validateConfigValue('myWxid', ['wxid_a'], KNOWN_KEYS), '微信账号格式无效')
  // 空串合法（清除语义）
  assert.equal(validateConfigValue('dbPath', '', KNOWN_KEYS), null)
  assert.equal(validateConfigValue('myWxName', '张三', KNOWN_KEYS), null)
})

test('validateConfigValue：数值键范围校验', () => {
  assert.equal(validateConfigValue('notificationDurationMs', 2999, KNOWN_KEYS), '通知持续时间超出范围')
  assert.equal(validateConfigValue('notificationDurationMs', 5000, KNOWN_KEYS), null)
  assert.equal(validateConfigValue('historyRetentionDays', 45, KNOWN_KEYS), '历史保留天数不受支持')
})

test('validateConfigValue：卡片大小校验', () => {
  assert.equal(validateConfigValue('notificationSize', 'huge', KNOWN_KEYS), '卡片大小仅支持 大 / 中 / 小')
  assert.equal(validateConfigValue('notificationSize', 'large', KNOWN_KEYS), null)
  assert.equal(validateConfigValue('notificationSize', 'small', KNOWN_KEYS), null)
})

test('validateConfigValue：动效风格校验', () => {
  assert.equal(validateConfigValue('motionScheme', 'elastic', KNOWN_KEYS), '动效风格不受支持')
  assert.equal(validateConfigValue('motionScheme', 'satin', KNOWN_KEYS), null)
  assert.equal(validateConfigValue('motionScheme', 'drift', KNOWN_KEYS), null)
})

test('validateNotifyRules：合法规则通过', () => {
  assert.equal(validateNotifyRules([validRule]), null)
  // durationMs/position 等扩展字段缺省合法（UI 不设置它们）
  assert.equal(validateNotifyRules([validRule, { ...validRule, id: 'r2' }]), null)
})

test('validateNotifyRules：扩展子字段类型与取值校验', () => {
  assert.equal(validateNotifyRules([{ ...validRule, muted: 'yes' }]), '通知规则静音标记无效')
  assert.equal(validateNotifyRules([{ ...validRule, accentColor: 'red' }]), '通知规则强调色无效')
  assert.equal(validateNotifyRules([{ ...validRule, accentColor: '#00ff00' }]), null)
  assert.equal(validateNotifyRules([{ ...validRule, durationMs: 'soon' }]), '通知规则停留时长无效')
  assert.equal(validateNotifyRules([{ ...validRule, durationMs: 20000 }]), null)
  assert.equal(validateNotifyRules([{ ...validRule, durationMs: 61000 }]), '通知规则停留时长无效')
  assert.equal(validateNotifyRules([{ ...validRule, position: 'middle' }]), '通知规则位置无效')
  assert.equal(validateNotifyRules([{ ...validRule, position: 'top-center' }]), null)
  assert.equal(validateNotifyRules([{ ...validRule, sound: 1 }]), '通知规则提示音无效')
})

test('validateNotifyRules：结构与匹配方式校验', () => {
  assert.equal(validateNotifyRules('rules'), '通知规则格式无效')
  assert.equal(validateNotifyRules([{ ...validRule, matchMode: 'both' }]), '通知规则匹配方式无效')
  assert.equal(validateNotifyRules([{ ...validRule, sessionIds: [1] }]), '通知规则会话格式无效')
  assert.equal(validateNotifyRules([{ ...validRule, keywords: '广告' }]), '通知规则关键词格式无效')
})
