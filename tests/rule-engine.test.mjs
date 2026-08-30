import test from 'node:test'
import assert from 'node:assert/strict'
import { RuleEngine } from '../electron/rules/ruleEngine.ts'

/** 规则引擎纯逻辑测试：matchMode 组合、关键词大小写、畸形条目跳过、效果字段透传。 */

function makeEngine(rules) {
  return new RuleEngine({ get: (key) => rules })
}

function payload(overrides = {}) {
  return {
    event: 'message.new',
    sessionId: 'wxid_a',
    sessionType: 'private',
    rawid: '1',
    sourceName: '张三',
    content: '今晚八点前把方案发我',
    timestamp: 1000,
    ...overrides
  }
}

const sessionRule = { id: 'r1', name: '静音某人', enabled: true, muted: true, sessionIds: ['wxid_a'], keywords: [], matchMode: 'any' }
const keywordRule = { id: 'r2', name: '静音广告', enabled: true, muted: true, sessionIds: [], keywords: ['优惠', '促销'], matchMode: 'any' }
const bothRule = { id: 'r3', name: '组内关键词', enabled: true, muted: true, sessionIds: ['wxid_a'], keywords: ['方案'], matchMode: 'all' }

test('无规则 / 非数组规则 → 空效果', () => {
  assert.deepEqual(makeEngine([]).match(payload()), {})
  assert.deepEqual(makeEngine('rules').match(payload()), {})
})

test('any 模式：会话命中或关键词命中（大小写不敏感）任一即生效', () => {
  assert.equal(makeEngine([sessionRule]).match(payload()).muted, true)
  const upper = makeEngine([{ ...keywordRule, keywords: ['URGENT'] }])
  assert.equal(upper.match(payload({ content: 'this is urgent please' })).muted, true)
  assert.deepEqual(makeEngine([keywordRule]).match(payload({ content: '正常聊天' })), {})
})

test('any 模式：空关键词列表退化为纯会话匹配', () => {
  const other = makeEngine([sessionRule])
  assert.equal(other.match(payload({ sessionId: 'wxid_b' })).muted, undefined)
})

test('all 模式：会话与关键词需同时满足；缺省一侧视为通过', () => {
  // 两者都命中
  assert.equal(makeEngine([bothRule]).match(payload()).muted, true)
  // 会话命中但关键词不中 → 不生效
  assert.deepEqual(makeEngine([bothRule]).match(payload({ content: '无关内容' })), {})
  // 关键词命中但会话不中 → 不生效
  assert.deepEqual(makeEngine([bothRule]).match(payload({ sessionId: 'wxid_b' })), {})
  // 只有会话、无关键词（matchMode=all）→ 会话命中即生效
  const sessionOnlyAll = { ...sessionRule, matchMode: 'all' }
  assert.equal(makeEngine([sessionOnlyAll]).match(payload()).muted, true)
})

test('按顺序取第一个命中的规则，后续规则不再评估', () => {
  const later = { id: 'later', name: '后规则', enabled: true, muted: false, accentColor: '#ff0000', sessionIds: ['wxid_a'], keywords: [], matchMode: 'any' }
  const effect = makeEngine([sessionRule, later]).match(payload())
  assert.equal(effect.muted, true)
  assert.equal(effect.accentColor, undefined)
})

test('禁用规则被跳过，不影响后续规则评估', () => {
  const disabled = { ...sessionRule, id: 'off', enabled: false }
  const effect = makeEngine([disabled, keywordRule]).match(payload({ content: '促销信息' }))
  assert.equal(effect.muted, true)
})

test('畸形规则条目（null / 非对象）被跳过', () => {
  assert.equal(makeEngine([null, 'x', sessionRule]).match(payload()).muted, true)
})

test('效果字段透传：accentColor/durationMs/position/sound/muted', () => {
  const rule = {
    ...sessionRule,
    muted: true,
    accentColor: '#00ff00',
    durationMs: 8000,
    position: 'top-center',
    sound: 'chime'
  }
  const effect = makeEngine([rule]).match(payload())
  assert.equal(effect.muted, true)
  assert.equal(effect.accentColor, '#00ff00')
  assert.equal(effect.durationMs, 8000)
  assert.equal(effect.position, 'top-center')
  assert.equal(effect.sound, 'chime')
})

test('durationMs 为 0 / accentColor 为空串时不透传（回退全局默认）', () => {
  const rule = { ...sessionRule, durationMs: 0, accentColor: '' }
  const effect = makeEngine([rule]).match(payload())
  assert.equal(effect.durationMs, undefined)
  assert.equal(effect.accentColor, undefined)
})

test('关键词为纯空白串时不参与匹配', () => {
  const blankKeyword = { ...keywordRule, keywords: ['   '] }
  assert.deepEqual(makeEngine([blankKeyword]).match(payload({ content: '今晚八点前把方案发我' })), {})
})
