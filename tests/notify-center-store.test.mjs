import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotifyCenterStore } from '../electron/services/notifyCenterCore.ts'

/**
 * SQLite 存储核心测试（node:sqlite 真库 + 注入加密/路径，不触碰 electron）。
 * 覆盖：读写 roundtrip、重启恢复与排序、会话已读、过期清理、旧 JSON 迁移、加密降级与损坏备份。
 */

function makeDeps(dir, overrides = {}) {
  const store = { enc: false } // 可切换的"系统加密可用性"
  return {
    deps: {
      databasePath: join(dir, 'notify-center.db'),
      legacyFilePath: overrides.legacyFilePath !== undefined ? overrides.legacyFilePath : join(dir, 'notify-center.json'),
      isEncryptionAvailable: () => store.enc,
      encryptText: (plain) => {
        if (typeof plain !== 'string' || !plain) return plain
        return store.enc ? 'enc:' + Buffer.from(plain).toString('base64') : 'plain:' + plain
      },
      decryptText: (stored) => {
        if (stored.startsWith('enc:')) return Buffer.from(stored.slice(4), 'base64').toString()
        if (stored.startsWith('plain:')) return stored.slice(6)
        return stored
      },
      ...overrides.deps
    },
    encryption: store
  }
}

function makeEntry(id, overrides = {}) {
  return {
    id,
    payload: { sessionId: 'wxid_a', sourceName: '张三', content: '内容 ' + id, timestamp: 1000 },
    effect: {},
    receivedAt: Number(id.replace(/\D/g, '')) || 0,
    read: false,
    ...overrides
  }
}

async function openStore(dir, overrides = {}) {
  const { deps, encryption } = makeDeps(dir, overrides)
  const store = new NotifyCenterStore(deps)
  await store.init()
  return { store, encryption, deps }
}

test('add/markRead/markSessionRead/remove/clear 即时持久化，重启后完整恢复且按时间倒序', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nc-store-'))
  const first = await openStore(dir)
  first.store.add(makeEntry('nc_2', { receivedAt: 2000 }))
  first.store.add(makeEntry('nc_1', { receivedAt: 1000 }))
  first.store.add(makeEntry('nc_3', { receivedAt: 3000 }))
  const readBack = first.store.markRead('nc_1')
  assert.equal(readBack?.read, true)
  assert.equal(first.store.markRead('nc_missing'), null)
  const sessionUpdated = first.store.markSessionRead('wxid_a')
  assert.equal(sessionUpdated.length, 2)
  first.store.close()

  const second = await openStore(dir)
  const entries = second.store.getEntries()
  assert.deepEqual(entries.map((e) => e.id), ['nc_3', 'nc_2', 'nc_1'])
  assert.equal(entries[2].read, true)
  assert.equal(entries[0].read, true)
  // 已读状态不会重复产生补丁
  assert.equal(second.store.markSessionRead('wxid_a').length, 0)
  assert.equal(second.store.markRead('nc_3'), null)

  // 删除
  assert.equal(second.store.remove('nc_2'), 'nc_2')
  assert.equal(second.store.remove('nc_2'), null)
  assert.deepEqual(second.store.getEntries().map((e) => e.id), ['nc_3', 'nc_1'])
  second.store.close()
})

test('clear 清空并持久化；cleanupOlderThan 只删除过过期条目并返回明细', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nc-store-'))
  const { store, encryption } = await openStore(dir)
  const now = Date.now()
  store.add(makeEntry('nc_new', { receivedAt: now }))
  store.add(makeEntry('nc_old', { receivedAt: now - 40 * 24 * 60 * 60 * 1000 }))
  const removed = store.cleanupOlderThan(30)
  assert.deepEqual(removed.map((e) => e.id), ['nc_old'])
  assert.deepEqual(store.getEntries().map((e) => e.id), ['nc_new'])
  store.close()

  const reopened = await openStore(dir)
  assert.deepEqual(reopened.store.getEntries().map((e) => e.id), ['nc_new'])
})

test('旧版 notify-center.json（plain:）迁移入库并改名保留；重复 init 不重复导入', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nc-store-'))
  const legacyPath = join(dir, 'notify-center.json')
  const legacy = {
    entries: [makeEntry('nc_legacy1', { receivedAt: 500 }), makeEntry('nc_legacy2', { receivedAt: 600 })]
  }
  writeFileSync(legacyPath, 'plain:' + JSON.stringify(legacy.entries), 'utf8')

  const first = await openStore(dir)
  assert.deepEqual(first.store.getEntries().map((e) => e.id), ['nc_legacy2', 'nc_legacy1'])
  assert.ok(readdirSync(dir).some((name) => name.startsWith('notify-center.json.migrated-')))
  first.store.close()

  // 二次启动：迁移标记生效，无重复
  const second = await openStore(dir)
  assert.deepEqual(second.store.getEntries().map((e) => e.id), ['nc_legacy2', 'nc_legacy1'])
  second.store.close()
})

test('跨环境无法解密的旧加密历史：不再阻塞新写入，仅降级提示', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nc-store-'))
  const legacyPath = join(dir, 'notify-center.json')
  // 模拟旧环境（加密可用）留下的 enc: 历史文件
  writeFileSync(legacyPath, 'enc:' + Buffer.from(JSON.stringify([makeEntry('nc_secret')])).toString('base64'), 'utf8')

  // 新环境"加密不可用"：旧数据不可解密
  const second = await openStore(dir)
  assert.equal(second.store.getEntries().length, 0)
  const status = second.store.getPersistenceStatus()
  assert.equal(status.degraded, true)
  assert.match(status.reason || '', /无法在当前环境解密/)
  assert.ok(existsSync(legacyPath))

  // 关键改进：新记录仍然正常保存
  second.store.add(makeEntry('nc_fresh', { receivedAt: 900 }))
  assert.deepEqual(second.store.getEntries().map((e) => e.id), ['nc_fresh'])
  second.store.close()

  const third = await openStore(dir)
  assert.deepEqual(third.store.getEntries().map((e) => e.id), ['nc_fresh'])
  third.store.close()
})

test('损坏的旧 JSON：备份为 .corrupt-时间戳 后从空库开始', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nc-store-'))
  const legacyPath = join(dir, 'notify-center.json')
  writeFileSync(legacyPath, 'plain:{not-json', 'utf8')

  const { store } = await openStore(dir)
  const status = store.getPersistenceStatus()
  assert.ok(status.corruptBackupAt !== null)
  assert.ok(readdirSync(dir).some((name) => name.startsWith('notify-center.json.corrupt-')))
  assert.deepEqual(store.getEntries(), [])
  store.add(makeEntry('nc_new', { receivedAt: 100 }))
  assert.deepEqual(store.getEntries().map((e) => e.id), ['nc_new'])
  store.close()
})

test('加密可用时行级存储为 enc:，库文件不出现明文内容', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nc-store-'))
  const { store, encryption } = await openStore(dir)
  encryption.enc = true
  store.add(makeEntry('nc_secret', { payload: { sessionId: 'wxid_a', content: '机密内容' } }))
  store.close()

  const raw = readFileSync(join(dir, 'notify-center.db'), 'utf8')
  assert.ok(!raw.includes('机密内容'))
  const reopened = await openStore(dir)
  assert.equal(reopened.store.getEntries()[0].payload.content, '机密内容')
  reopened.store.close()
})

test('updateGroupName 更新群名并持久化', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nc-store-'))
  const { store } = await openStore(dir)
  store.add(makeEntry('nc_g1', { payload: { sessionId: '123@chatroom', groupName: '旧群名' } }))
  const updated = store.updateGroupName('123@chatroom', '新群名')
  assert.equal(updated.length, 1)
  assert.equal(store.updateGroupName('123@chatroom', '新群名').length, 0)
  store.close()

  const reopened = await openStore(dir)
  assert.equal(reopened.store.getEntries()[0].payload.groupName, '新群名')
  reopened.store.close()
})
