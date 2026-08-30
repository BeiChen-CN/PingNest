import test from 'node:test'
import assert from 'node:assert/strict'
import { MessagePushService } from '../electron/services/messagePushCore.ts'

/** 合成消息源：注入 fake ChatService，验证从基线到推送事件的完整链路（不触碰微信/DLL）。 */

function makeConfigService(overrides = {}) {
  const values = {
    notificationEnabled: true,
    notifyCenterEnabled: true,
    autoReconnect: true,
    reconnectIntervalSeconds: 3,
    pollIntervalSeconds: 2,
    notificationFilterMode: 'all',
    notificationFilterList: [],
    ...overrides
  }
  return { get: (key) => values[key] }
}

function makeChatService(sessions, messagesBySession) {
  return {
    connect: async () => ({ success: true }),
    getSessions: async () => ({ success: true, sessions }),
    getNewMessages: async (sessionId) => ({ success: true, messages: messagesBySession[sessionId] || [] }),
    getContactAvatar: async (username) => ({ displayName: '联系人' + username }),
    getGroupNicknames: async () => ({})
  }
}

function makeService({ config, sessions, messages }) {
  const events = []
  const service = new MessagePushService({
    configService: makeConfigService(config),
    chatService: makeChatService(sessions, messages)
  })
  service.on('message.new', (payload) => events.push({ type: 'message.new', payload }))
  service.on('message.revoke', (payload) => events.push({ type: 'message.revoke', payload }))
  return { service, events }
}

const baseSessions = [{ username: 'wxid_a', last_timestamp: 100, unread_count: 0, type: 'private' }]

test('首轮同步仅建立基线，不推送历史消息', async () => {
  const { service, events } = makeService({
    sessions: baseSessions,
    messages: { wxid_a: [{ messageKey: 'm0', isSend: 0, createTime: 90, localType: 1, parsedContent: '历史消息' }] }
  })
  await service.flushPendingChanges()
  assert.equal(events.length, 0)
})

test('会话更新后推送新消息，载荷含来源与内容', async () => {
  const messages = {}
  const { service, events } = makeService({ sessions: [...baseSessions], messages: {} })
  await service.flushPendingChanges()

  const updated = [{ username: 'wxid_a', last_timestamp: 200, unread_count: 1, type: 'private' }]
  messages.wxid_a = [{ messageKey: 'm1', isSend: 0, createTime: 150, localType: 1, parsedContent: '你好' }]
  service.chatService = makeChatService(updated, messages)

  await service.flushPendingChanges()
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'message.new')
  assert.equal(events[0].payload.sessionId, 'wxid_a')
  assert.equal(events[0].payload.sourceName, '联系人wxid_a')
  assert.equal(events[0].payload.content, '你好')
})

test('同一 messageKey 在去重缓存内只推送一次', async () => {
  const messages = { wxid_a: [{ messageKey: 'm1', isSend: 0, createTime: 150, localType: 1, parsedContent: '你好' }] }
  const { service, events } = makeService({ sessions: [...baseSessions], messages: {} })
  await service.flushPendingChanges()

  service.chatService = makeChatService([{ username: 'wxid_a', last_timestamp: 200, unread_count: 1, type: 'private' }], messages)
  await service.flushPendingChanges()
  assert.equal(events.length, 1)

  // 会话再次变化（重新成为候选），但相同 messageKey 命中去重缓存，不重复推送
  service.chatService = makeChatService([{ username: 'wxid_a', last_timestamp: 210, unread_count: 2, type: 'private' }], messages)
  await service.flushPendingChanges()
  assert.equal(events.length, 1)
})

test('自己发送的消息不推送', async () => {
  const messages = { wxid_a: [{ messageKey: 'out1', isSend: 1, createTime: 150, localType: 1, parsedContent: '我发出的' }] }
  const { service, events } = makeService({ sessions: [...baseSessions], messages: {} })
  await service.flushPendingChanges()

  service.chatService = makeChatService([{ username: 'wxid_a', last_timestamp: 200, unread_count: 1, type: 'private' }], messages)
  await service.flushPendingChanges()
  assert.equal(events.length, 0)
})

test('撤回批次推送原消息与撤回事件，撤回内容回溯原文', async () => {
  const messages = {
    wxid_a: [
      { messageKey: 'orig', isSend: 0, createTime: 150, localType: 1, parsedContent: '原始内容' },
      { messageKey: 'revoke', isSend: 0, createTime: 200, localType: 10000, parsedContent: '对方 撤回了一条消息', rawContent: '对方 撤回了一条消息' }
    ]
  }
  const { service, events } = makeService({ sessions: [...baseSessions], messages: {} })
  await service.flushPendingChanges()

  service.chatService = makeChatService([{ username: 'wxid_a', last_timestamp: 300, unread_count: 2, type: 'private' }], messages)
  await service.flushPendingChanges()
  assert.equal(events.length, 2)
  assert.equal(events[0].type, 'message.new')
  assert.equal(events[1].type, 'message.revoke')
  assert.equal(events[1].payload.content, '对方撤回了一条消息，内容为「原始内容」')
})

test('黑名单会话命中时不推送', async () => {
  const messages = { wxid_a: [{ messageKey: 'm1', isSend: 0, createTime: 150, localType: 1, parsedContent: '你好' }] }
  const { service, events } = makeService({
    config: { notificationFilterMode: 'blacklist', notificationFilterList: ['wxid_a'] },
    sessions: [...baseSessions],
    messages: {}
  })
  await service.flushPendingChanges()

  service.chatService = makeChatService([{ username: 'wxid_a', last_timestamp: 200, unread_count: 1, type: 'private' }], messages)
  await service.flushPendingChanges()
  assert.equal(events.length, 0)
})

test('连续失败达到阈值后 getDegradedReason 返回原因，成功后复位', async () => {
  const okChat = makeChatService([...baseSessions], {})
  const failingChat = {
    connect: async () => ({ success: true }),
    getSessions: async () => ({ success: false, error: 'WCDB 未连接' }),
    getNewMessages: async () => ({ success: true, messages: [] }),
    getContactAvatar: async () => ({}),
    getGroupNicknames: async () => ({})
  }
  const service = new MessagePushService({ configService: makeConfigService(), chatService: okChat })
  await service.flushPendingChanges() // 建立基线

  service.chatService = failingChat
  await service.flushPendingChanges()
  assert.equal(service.getDegradedReason(), null) // 第 1 次失败不报警

  await service.flushPendingChanges()
  assert.equal(service.getDegradedReason(), 'WCDB 未连接') // 连续第 2 次

  service.chatService = okChat
  await service.flushPendingChanges()
  assert.equal(service.getDegradedReason(), null)
})
