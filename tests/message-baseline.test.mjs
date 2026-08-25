import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateMessageQuerySince,
  shouldInspectSession
} from '../electron/services/messageBaseline.ts'
import {
  normalizeMessageSendState,
  resolveSqlMessageSendState,
  shouldPushIncomingMessage
} from '../electron/services/messageDirection.ts'

test('a newly observed session is inspected', () => {
  assert.equal(shouldInspectSession(undefined, 500, 1), true)
})

test('existing sessions are inspected only when timestamp or unread count advances', () => {
  const previous = { lastTimestamp: 500, unreadCount: 2 }

  assert.equal(shouldInspectSession(previous, 500, 2), false)
  assert.equal(shouldInspectSession(previous, 501, 2), true)
  assert.equal(shouldInspectSession(previous, 500, 3), true)
})

test('new sessions query only around their latest message', () => {
  assert.equal(calculateMessageQuerySince(undefined, 500, 2, 1000), 498)
  assert.equal(calculateMessageQuerySince(undefined, 0, 2, 1000), 998)
})

test('existing sessions query from the previous baseline with lookback', () => {
  const previous = { lastTimestamp: 500, unreadCount: 0 }
  assert.equal(calculateMessageQuerySince(previous, 900, 2, 1000), 498)
})

test('SQL message direction uses the row id from the current database', () => {
  assert.equal(resolveSqlMessageSendState(4, 4), 1)
  assert.equal(resolveSqlMessageSendState(4, 89), 0)
  assert.equal(resolveSqlMessageSendState(null, 89), null)
})

test('message direction normalization handles worker values', () => {
  assert.equal(normalizeMessageSendState('1'), 1)
  assert.equal(normalizeMessageSendState('0'), 0)
  assert.equal(normalizeMessageSendState(undefined), null)
})

test('own messages never push and unknown direction requires unread growth', () => {
  assert.equal(shouldPushIncomingMessage(1, true), false)
  assert.equal(shouldPushIncomingMessage(0, false), true)
  assert.equal(shouldPushIncomingMessage(null, false), false)
  assert.equal(shouldPushIncomingMessage(null, true), true)
})
