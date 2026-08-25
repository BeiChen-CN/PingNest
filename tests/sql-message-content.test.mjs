import test from 'node:test'
import assert from 'node:assert/strict'
import { mapSqlMessageContent } from '../electron/services/sqlMessageContent.ts'

test('SQL revoke system messages preserve XML content for detection', () => {
  const content = '<sysmsg type="revokemsg"><revokemsg>...</revokemsg></sysmsg>'
  assert.deepEqual(mapSqlMessageContent(10000, content), {
    rawContent: content,
    parsedContent: content
  })
})

test('SQL media messages do not expose raw payload as text', () => {
  assert.deepEqual(mapSqlMessageContent(3, 'binary-payload'), {
    rawContent: '',
    parsedContent: ''
  })
})
