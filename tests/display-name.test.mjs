import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDisplayName,
  resolveContactDisplayName,
  resolveGroupDisplayName,
  resolveSessionDisplayName
} from '../electron/services/displayName.ts'

test('contact nickname supports WCDB snake_case fields', () => {
  assert.equal(resolveContactDisplayName('wxid_123', { nick_name: '微信昵称' }), '微信昵称')
})

test('contact remark takes precedence over mapped and profile names', () => {
  assert.equal(resolveContactDisplayName('wxid_123', { remark: '备注名', nick_name: '微信昵称' }, '映射名称'), '备注名')
})

test('raw wxid is not treated as a display name', () => {
  assert.equal(normalizeDisplayName('wxid_123', 'wxid_123'), '')
  assert.equal(resolveContactDisplayName('wxid_123', {}, 'wxid_123'), undefined)
})

test('session display name supports snake_case without falling back to username', () => {
  assert.equal(resolveSessionDisplayName({ username: 'wxid_123', display_name: '会话名称' }), '会话名称')
  assert.equal(resolveSessionDisplayName({ username: 'wxid_123' }), '')
})

test('group display name ignores the last sender display name', () => {
  assert.equal(resolveGroupDisplayName({ username: 'team@chatroom', last_sender_display_name: '发送者' }), '')
  assert.equal(resolveGroupDisplayName({ username: 'team@chatroom', display_name: '项目群', last_sender_display_name: '发送者' }), '项目群')
})
