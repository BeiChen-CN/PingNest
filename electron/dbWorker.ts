/**
 * dbWorker：独立进程承载 WCDB 数据层（utilityProcess）
 * 目的：将 wcdb_api.dll 的加载与查询隔离到独立进程，
 * 避免主进程（BrowserWindow/vite 注入等环境）导致 wcdb_init 失败。
 */
import { wcdbCore } from './services/wcdbCore'

const parentPort: any = (process as any).parentPort
if (!parentPort) {
  console.error('[dbWorker] 无 parentPort，请通过 utilityProcess.fork 启动')
  process.exit(1)
}

// 启动自检：立即上报，验证消息通道
try {
  parentPort.postMessage({ type: 'result', id: 0, result: { success: true, boot: true, pid: process.pid } })
} catch (e) {
  console.error('[dbWorker] 启动自检失败:', e)
}

// 保持进程存活：Node 事件循环空转后 utilityProcess 会自动退出，
// 导致监控管道随进程消失。用空转定时器保持进程常驻。
setInterval(() => { }, 60_000)

function reply(id: number, result: unknown): void {
  parentPort.postMessage({ type: 'result', id, result })
}

/**
 * SQL 只读白名单校验：仅允许 SELECT 与只读 PRAGMA，禁止任何写操作/多语句。
 * 防止内部 execQuery 出口被滥用（目前仅主进程内部使用，加双重保险）。
 */
function validateReadOnlySql(sql: string): string | null {
  const raw = String(sql || '')
  if (!raw.trim()) return 'SQL 为空'
  // 写关键字（含字符串字面量外的部分）
  const outsideStrings = raw.replace(/'[^']*'/g, "''").replace(/"([^"]*)"/g, '""')
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex)\b/i.test(outsideStrings)) {
    return '仅允许只读 SELECT 查询'
  }
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed.startsWith('select ') && !trimmed.startsWith('pragma ')) {
    return '仅允许 SELECT 或只读 PRAGMA'
  }
  if (/pragma\s+(journal_mode|wal_checkpoint|synchronous|locking_mode|page_size|encryption|temp_store|foreign_keys|user_version)/i.test(raw)) {
    return '该 PRAGMA 会修改数据库状态，已禁止'
  }
  return null
}

parentPort.on('message', (e: any) => {
  const { id, type, payload } = e?.data || {}
  if (type === 'ping') {
    reply(id, { success: true, pong: true })
    return
  }

  void (async () => {
    try {
      switch (type) {
        case 'setPaths': {
          wcdbCore.setPaths(payload?.resourcesPath, payload?.userDataPath)
          wcdbCore.setLogEnabled(true)
          reply(id, { success: true })
          break
        }
        case 'open': {
          const ok = await wcdbCore.open(
            String(payload?.dbPath || ''),
            String(payload?.key || ''),
            String(payload?.wxid || '')
          )
          reply(id, { success: ok, error: ok ? undefined : (wcdbCore.getLastInitError() || '打开数据库失败') })
          break
        }
        case 'isReady': {
          reply(id, { success: true, ready: wcdbCore.isReady() })
          break
        }
        case 'getSessions': {
          reply(id, await wcdbCore.getSessions())
          break
        }
        case 'getNewMessages': {
          reply(id, await wcdbCore.getNewMessages(String(payload?.sessionId || ''), Number(payload?.since || 0), Number(payload?.limit || 1000)))
          break
        }
        case 'getContact': {
          reply(id, await wcdbCore.getContact(String(payload?.username || '')))
          break
        }
        case 'getAvatarUrls': {
          reply(id, await wcdbCore.getAvatarUrls(Array.isArray(payload?.usernames) ? payload.usernames : []))
          break
        }
        case 'getDisplayNames': {
          reply(id, await wcdbCore.getDisplayNames(Array.isArray(payload?.usernames) ? payload.usernames : []))
          break
        }
        case 'getGroupNicknames': {
          reply(id, await wcdbCore.getGroupNicknames(String(payload?.chatroomId || '')))
          break
        }
        case 'execQuery': {
          const sql = String(payload?.sql || '')
          const invalid = validateReadOnlySql(sql)
          if (invalid) {
            reply(id, { success: false, error: invalid })
            break
          }
          reply(id, await wcdbCore.execQuery(String(payload?.kind || ''), payload?.dbPath ? String(payload.dbPath) : null, sql))
          break
        }
        case 'startMonitor': {
          const ok = wcdbCore.startMonitor((type, json) => {
            parentPort.postMessage({ type: 'monitor', payload: { type, json } })
          })
          reply(id, { success: ok })
          break
        }
        case 'setMonitorOptions': {
          wcdbCore.setMonitorOptions(
            payload?.autoReconnect !== false,
            Number(payload?.intervalSeconds || 3)
          )
          reply(id, { success: true })
          break
        }
        case 'close': {
          wcdbCore.close()
          reply(id, { success: true })
          break
        }
        default:
          reply(id, { success: false, error: '未知命令: ' + type })
      }
    } catch (err) {
      reply(id, { success: false, error: String((err as Error)?.message || err) })
    }
  })()
})
