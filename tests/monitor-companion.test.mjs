import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMonitorPipeName, isMonitorStartAccepted, MONITOR_PIPE_PREFIX } from '../electron/services/wcdb/monitorCompanion.ts'

test('伴生监控管道名与 C++ 侧 sprintf 规则一致', () => {
  assert.equal(buildMonitorPipeName('4242'), '\\\\.\\pipe\\pingnest_monitor_4242')
  assert.ok(MONITOR_PIPE_PREFIX.endsWith('pingnest_monitor_'))
})

test('伴生监控管道名：空 suffix 回退到当前进程号', () => {
  assert.equal(buildMonitorPipeName(''), '\\\\.\\pipe\\pingnest_monitor_' + process.pid)
  assert.equal(buildMonitorPipeName('   '), '\\\\.\\pipe\\pingnest_monitor_' + process.pid)
})

test('伴生监控启动返回码：0=成功 1=已在运行，其余失败', () => {
  assert.equal(isMonitorStartAccepted(0), true)
  assert.equal(isMonitorStartAccepted(1), true)
  assert.equal(isMonitorStartAccepted(2), false)
  assert.equal(isMonitorStartAccepted(3), false)
  assert.equal(isMonitorStartAccepted(-1), false)
})
