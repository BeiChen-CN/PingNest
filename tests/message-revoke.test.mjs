import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractReplaceMsg,
  findRevokedOriginalInMessages,
  isRevokeSystemMessage,
  isSelfRevokeMessage
} from '../electron/services/messageRevoke.ts'

test('isRevokeSystemMessage：localType 10000 + 撤回文本命中', () => {
  assert.equal(isRevokeSystemMessage({ localType: 10000, rawContent: '你撤回了一条消息', parsedContent: '' }), true)
  assert.equal(isRevokeSystemMessage({ localType: 10002, rawContent: '', parsedContent: 'xxx 撤回了一条消息' }), true)
})

test('isRevokeSystemMessage：revokemsg XML 标记命中（任意 localType）', () => {
  assert.equal(isRevokeSystemMessage({ localType: 49, rawContent: '<revokemsg>xx</revokemsg>', parsedContent: '' }), true)
  assert.equal(isRevokeSystemMessage({ localType: 49, rawContent: '<replacemsg><![CDATA[a]]></replacemsg>', parsedContent: '' }), true)
})

test('isRevokeSystemMessage：普通消息不命中', () => {
  assert.equal(isRevokeSystemMessage({ localType: 1, rawContent: '今天天气不错', parsedContent: '今天天气不错' }), false)
  assert.equal(isRevokeSystemMessage({ localType: 10000, rawContent: '你已添加了对方', parsedContent: '' }), false)
})

test('isSelfRevokeMessage：仅"你撤回"算自己撤回', () => {
  assert.equal(isSelfRevokeMessage({ rawContent: '你撤回了一条消息', parsedContent: '' }), true)
  assert.equal(isSelfRevokeMessage({ rawContent: '老王 撤回了一条消息', parsedContent: '' }), false)
  assert.equal(isSelfRevokeMessage({ rawContent: '', parsedContent: '' }), false)
})

test('extractReplaceMsg：兼容 CDATA 与纯文本两种包裹', () => {
  assert.equal(extractReplaceMsg('<replacemsg><![CDATA[ 被撤回的内容 ]]></replacemsg>'), '被撤回的内容')
  assert.equal(extractReplaceMsg('<replacemsg>纯文本内容</replacemsg>'), '纯文本内容')
  assert.equal(extractReplaceMsg('没有标记'), null)
})

test('findRevokedOriginalInMessages：取撤回之前最后一条收到的非撤回消息', () => {
  const revoke = { messageKey: 'k4', createTime: 400, isSend: 0 }
  const messages = [
    { messageKey: 'k1', createTime: 100, isSend: 0, content: '第一条' },
    { messageKey: 'k2', createTime: 200, isSend: 1, content: '自己发的' },
    { messageKey: 'k3', createTime: 300, isSend: 0, content: '最后一条', rawContent: '' },
    revoke
  ]
  const original = findRevokedOriginalInMessages(messages, revoke)
  assert.equal(original?.messageKey, 'k3')
})

test('findRevokedOriginalInMessages：排除其他撤回消息与时间晚于撤回的消息', () => {
  const revoke = { messageKey: 'k3', createTime: 300, isSend: 0 }
  const messages = [
    { messageKey: 'k1', createTime: 100, isSend: 0 },
    { messageKey: 'k2', createTime: 500, isSend: 0 },
    { messageKey: 'kx', createTime: 200, isSend: 0, localType: 10000, rawContent: '撤回了一条消息' },
    revoke
  ]
  assert.equal(findRevokedOriginalInMessages(messages, revoke)?.messageKey, 'k1')
})

test('findRevokedOriginalInMessages：没有候选时返回 null', () => {
  assert.equal(findRevokedOriginalInMessages([{ messageKey: 'a', isSend: 1 }], { messageKey: 'b', createTime: 1 }), null)
})
