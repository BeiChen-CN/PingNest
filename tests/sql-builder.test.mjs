import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  buildMessageTableExistsSql,
  buildMessagesByTableSql,
  buildName2IdRowIdSql,
  buildName2IdUsernamesSql,
  messageTableName,
  validateReadOnlySql
} from '../electron/services/wcdb/sqlBuilder.ts'

test('messageTableName：按 md5(sessionId) 生成分表名', () => {
  const expected = 'Msg_' + createHash('md5').update('wxid_demo').digest('hex').toLowerCase()
  assert.equal(messageTableName('wxid_demo'), expected)
})

test('buildMessageTableExistsSql：小写表名做存在性检查', () => {
  const sql = buildMessageTableExistsSql('wxid_demo')
  assert.match(sql, /^SELECT name FROM sqlite_master/)
  assert.match(sql, new RegExp("lower\\(name\\)='msg_" + createHash('md5').update('wxid_demo').digest('hex').toLowerCase() + "'"))
})

test('buildMessagesByTableSql：since 非负、limit 收敛到 [1,5000]', () => {
  const hash = createHash('md5').update('s').digest('hex').toLowerCase()
  const sql = buildMessagesByTableSql('s', -5, 99999)
  assert.match(sql, new RegExp('WHERE create_time > 0'))
  assert.match(sql, new RegExp('LIMIT 5000'))
  assert.match(sql, new RegExp('"Msg_' + hash + '"'))
  const tiny = buildMessagesByTableSql('s', 0, 0)
  assert.match(tiny, /LIMIT 1/)
})

test('buildName2IdRowIdSql：转义单引号防注入', () => {
  const sql = buildName2IdRowIdSql("wxid_o'clock")
  assert.match(sql, /'wxid_o''clock'/)
})

test('buildName2IdUsernamesSql：去重、收敛为正整数、空集返回空串', () => {
  assert.equal(buildName2IdUsernamesSql([]), '')
  assert.equal(buildName2IdUsernamesSql([0, -3, Number.NaN]), '')
  assert.equal(buildName2IdUsernamesSql([5, 5, 2.9, -1]), 'SELECT rowid, user_name FROM Name2Id WHERE rowid IN (5,2)')
  const sql = buildName2IdUsernamesSql([7])
  assert.match(sql, /^SELECT rowid, user_name FROM Name2Id WHERE rowid IN \(7\)$/)
  // 批量语句同样必须通过只读白名单
  assert.equal(validateReadOnlySql(sql), null)
})

test('validateReadOnlySql：允许 SELECT 与只读 PRAGMA', () => {
  assert.equal(validateReadOnlySql('SELECT * FROM Msg_x'), null)
  assert.equal(validateReadOnlySql('  pragma table_info(Msg_x)'), null)
  assert.equal(validateReadOnlySql("SELECT 'insert' AS word"), null)
})

test('validateReadOnlySql：拒绝写操作与多语句关键字', () => {
  // 写关键字检查先于语句前缀检查，因此统一报"仅允许只读 SELECT 查询"
  assert.equal(validateReadOnlySql('DELETE FROM Msg_x'), '仅允许只读 SELECT 查询')
  assert.equal(validateReadOnlySql('INSERT INTO Msg_x VALUES (1)'), '仅允许只读 SELECT 查询')
  assert.equal(validateReadOnlySql('UPDATE Msg_x SET a=1'), '仅允许只读 SELECT 查询')
  assert.equal(validateReadOnlySql('SELECT 1; DROP TABLE Msg_x'), '仅允许只读 SELECT 查询')
  // 不含写关键字的危险 PRAGMA 由 PRAGMA 黑名单拦截
  assert.equal(validateReadOnlySql('PRAGMA journal_mode = WAL'), '该 PRAGMA 会修改数据库状态，已禁止')
  assert.equal(validateReadOnlySql('PRAGMA wal_checkpoint'), '该 PRAGMA 会修改数据库状态，已禁止')
  assert.equal(validateReadOnlySql('   '), 'SQL 为空')
  assert.equal(validateReadOnlySql('EXPLAIN SELECT 1'), '仅允许 SELECT 或只读 PRAGMA')
})
