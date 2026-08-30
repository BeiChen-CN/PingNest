import test from 'node:test'
import assert from 'node:assert/strict'
import { DbWorkerClient } from '../electron/services/dbWorkerClient.ts'

/** dbWorkerClient 协议契约测试：注入 fake worker，验证请求-响应配对、超时、退出拒答与监控分发。 */

function makeFakeWorker() {
  const listeners = { message: [], exit: [] }
  const sent = []
  const worker = {
    postMessage: (msg) => sent.push(msg),
    on: (event, listener) => { listeners[event]?.push(listener) },
    kill: () => { },
    stdout: null,
    stderr: null,
  }
  return {
    worker,
    sent,
    emitMessage: (msg) => { for (const listener of listeners.message) listener(msg) },
    emitExit: (code) => { for (const listener of listeners.exit) listener(code) },
  }
}

test('call：按 id 配对响应并 resolve', async () => {
  const fake = makeFakeWorker()
  const client = new DbWorkerClient(() => fake.worker)
  const pending = client.call('getSessions', {}, 500)
  assert.equal(fake.sent.length, 1)
  const request = fake.sent[0]
  assert.equal(request.type, 'getSessions')
  fake.emitMessage({ type: 'result', id: request.id, result: { success: true, sessions: [] } })
  const result = await pending
  assert.equal(result.success, true)
})

test('call：超时后 reject，迟到的响应不影响后续请求配对', async () => {
  const fake = makeFakeWorker()
  const client = new DbWorkerClient(() => fake.worker)
  await assert.rejects(
    client.call('getSessions', {}, 20),
    /数据进程响应超时 \(getSessions\)/
  )
  const second = client.call('ping', {}, 200)
  assert.equal(fake.sent.length, 2)
  fake.emitMessage({ type: 'result', id: fake.sent[1].id, result: { success: true, pong: true } })
  assert.equal((await second).success, true)
})

test('worker 退出：pending 全部拒绝，onExit 回调触发，下次调用重新 fork', async () => {
  const workers = []
  const exitCallbacks = []
  const client = new DbWorkerClient(() => {
    const created = makeFakeWorker()
    workers.push(created)
    return created.worker
  })
  client.onExit(() => exitCallbacks.push(true))

  const pending = client.call('getSessions', {}, 500)
  assert.equal(workers.length, 1)
  workers[0].emitExit(1)
  await assert.rejects(pending, /数据进程已退出 \(code=1\)/)
  assert.equal(exitCallbacks.length, 1)

  // 再次调用触发重新 fork，新请求可在新 worker 上配对
  const restarted = client.call('ping', {}, 500)
  assert.equal(workers.length, 2)
  workers[1].emitMessage({ type: 'result', id: workers[1].sent[0].id, result: { success: true, pong: true } })
  assert.equal((await restarted).success, true)
})

test('monitor 消息分发给监听器，单个监听器异常不影响其他监听器', async () => {
  const fake = makeFakeWorker()
  const client = new DbWorkerClient(() => fake.worker)
  const received = []
  client.addMonitorListener(() => { throw new Error('boom') })
  client.addMonitorListener((type, json) => received.push([type, json]))
  // 与生产一致：worker 在首次 call() 时创建并接线，先完成一次握手
  const bootstrap = client.call('ping', {}, 200)
  fake.emitMessage({ type: 'result', id: fake.sent[0].id, result: { success: true, pong: true } })
  await bootstrap
  fake.emitMessage({ type: 'monitor', payload: { type: 'update', json: '{"table":"session"}' } })
  assert.deepEqual(received, [['update', '{"table":"session"}']])
})

test('dispose：拒绝 pending 并 kill 进程', async () => {
  const fake = makeFakeWorker()
  let killed = false
  fake.worker.kill = () => { killed = true }
  const client = new DbWorkerClient(() => fake.worker)
  const pending = client.call('getSessions', {}, 500)
  client.dispose()
  await assert.rejects(pending, /数据进程已关闭/)
  assert.equal(killed, true)
  // dispose 后 isReady 直接返回未就绪，不再发消息
  assert.deepEqual(await client.isReady(), { success: true, ready: false })
  assert.equal(fake.sent.length, 1)
})
