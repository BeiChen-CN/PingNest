import test from 'node:test'
import assert from 'node:assert/strict'
import { groupHistoryEntries } from '../src/features/dashboard/historyGrouping.ts'

function entry(id, sessionId, sourceName, groupName, timestamp, read = false) {
  return {
    id,
    payload: { sessionId, sessionType: groupName ? 'group' : 'private', sourceName, groupName, content: id, timestamp, event: 'message.new' },
    effect: {},
    receivedAt: timestamp * 1000,
    read
  }
}

test('private notifications are grouped by contact session', () => {
  const groups = groupHistoryEntries([
    entry('a', 'wxid_alice', 'Alice', undefined, 10),
    entry('b', 'wxid_alice', 'Alice', undefined, 20, true)
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].name, 'Alice')
  assert.deepEqual(groups[0].entries.map((item) => item.id), ['b', 'a'])
  assert.equal(groups[0].unreadCount, 1)
})

test('different senders in the same group stay in one conversation', () => {
  const groups = groupHistoryEntries([
    entry('a', 'team@chatroom', 'Alice', '项目群', 10),
    entry('b', 'team@chatroom', 'Bob', '项目群', 20),
    entry('c', 'other@chatroom', 'Carol', '另一个群', 30)
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups.find((group) => group.id === 'team@chatroom')?.entries.length, 2)
  assert.equal(groups.find((group) => group.id === 'team@chatroom')?.name, '项目群')
})

test('legacy group records use source name when group name is absent', () => {
  const legacy = entry('a', 'legacy@chatroom', '旧版群名', undefined, 10)
  legacy.payload.sessionType = 'group'
  const groups = groupHistoryEntries([legacy])
  assert.equal(groups[0].name, '旧版群名')
})

test('sender name is not used as a group title', () => {
  const legacy = entry('a', 'legacy@chatroom', '张三', '张三', 10)
  legacy.payload.sessionType = 'group'
  const groups = groupHistoryEntries([legacy])
  assert.equal(groups[0].name, '群聊')
})

test('legacy private records stored as other are normalized as private', () => {
  const legacy = entry('a', 'wxid_legacy', '旧联系人', undefined, 10)
  legacy.payload.sessionType = 'other'
  const groups = groupHistoryEntries([legacy])
  assert.equal(groups[0].type, 'private')
  assert.equal(groups[0].name, '旧联系人')
})
