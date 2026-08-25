/**
 * keyWorker：独立进程获取微信数据库密钥（utilityProcess）
 * 目的：wx_key.dll 的 Hook 操作会污染宿主进程，导致 wcdb_api.dll 的 wcdb_init 失败。
 * 因此将密钥获取隔离到独立进程，主进程保持干净。
 */
import { KeyService } from './services/keyService'

const keyService = new KeyService()

// 诊断：确认 DLL 路径
try {
  const p = process.env.WX_KEY_DLL_PATH || ''
  const { existsSync } = require('fs')
  console.error('[keyWorker] WX_KEY_DLL_PATH=' + p + ' exists=' + existsSync(p) + ' cwd=' + process.cwd())
} catch { }

const parentPort: any = (process as any).parentPort
if (!parentPort) {
  console.error('[keyWorker] 无 parentPort，请通过 utilityProcess.fork 启动')
  process.exit(1)
}

parentPort.on('message', (e: any) => {
  const { id, type, payload } = e?.data || {}
  if (type === 'ping') {
    parentPort.postMessage({ type: 'result', id, result: { success: true, pong: true } })
    return
  }
  if (type === 'getKey') {
    void (async () => {
      try {
        const result = await keyService.autoGetDbKey(
          payload?.timeoutMs || 60_000,
          (message: string, level: number) => {
            parentPort.postMessage({ type: 'status', id, message, level })
          }
        )
        parentPort.postMessage({ type: 'result', id, result })
      } catch (err) {
        parentPort.postMessage({
          type: 'result',
          id,
          result: { success: false, error: String((err as Error)?.message || err) }
        })
      }
    })()
    return
  }
  parentPort.postMessage({ type: 'result', id, result: { success: false, error: '未知命令: ' + type } })
})
