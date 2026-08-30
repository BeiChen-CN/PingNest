import type { UtilityProcess } from 'electron'
import { join } from 'path'

export interface DbWorkerResult<T = unknown> {
  success: boolean
  error?: string
  [key: string]: unknown
}

/** dbWorker 需要用到的最小进程接口：electron UtilityProcess 与测试 fake 都满足该形状 */
export type ForkableWorker = Pick<UtilityProcess, 'postMessage' | 'on' | 'kill' | 'stdout' | 'stderr'>

export interface DbWorkerForkOptions {
  serviceName: string
  env: NodeJS.ProcessEnv
}

/**
 * fork 工厂可注入：node:test 用 fake worker 直接加载本模块做协议契约测试，
 * 生产路径走默认实现（运行期才解析 electron，避免模块顶层依赖 electron）。
 */
export type DbWorkerFork = (modulePath: string, options: DbWorkerForkOptions) => ForkableWorker

function defaultFork(modulePath: string, options: DbWorkerForkOptions): ForkableWorker {
  const { utilityProcess } = require('electron') as typeof import('electron')
  return utilityProcess.fork(modulePath, [], options)
}

/**
 * DbWorkerClient：主进程侧封装，与 dbWorker（utilityProcess）通信。
 * 数据层（wcdb_api.dll）在独立进程运行，主进程通过消息调用。
 */
export class DbWorkerClient {
  private worker: ForkableWorker | null = null
  private pending = new Map<number, { worker: ForkableWorker; resolve: (v: any) => void; reject: (e: Error) => void }>()
  private msgId = 0
  private monitorListeners = new Set<(type: string, json: string) => void>()
  private exitListeners = new Set<() => void>()
  private readonly forkWorker: DbWorkerFork

  // 显式赋值而非参数属性：node:test 直接加载本文件时类型擦除不支持 parameter property
  constructor(forkWorker: DbWorkerFork = defaultFork) {
    this.forkWorker = forkWorker
  }

  /** 注册 worker 异常退出回调：上层持有的连接/监控标志随之失效，需要复位重建 */
  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener)
    return () => { this.exitListeners.delete(listener) }
  }

  private ensure(): ForkableWorker {
    if (this.worker) return this.worker

    // __dirname 在打包 CJS 运行时可用；node:test 的 ESM 上下文没有它，
    // fake 工厂不使用该路径，因此退化为占位名
    const workerPath = typeof __dirname !== 'undefined' ? join(__dirname, 'dbWorker.js') : 'dbWorker.js'
    const worker = this.forkWorker(workerPath, {
      serviceName: 'pingnest-db',
      env: { ...process.env }
    })
    this.worker = worker

    worker.on('message', (msg: any) => {
      if (!msg) return
      if (msg.type === 'monitor') {
        for (const listener of this.monitorListeners) {
          try {
            listener(msg.payload?.type, msg.payload?.json)
          } catch (e) {
            console.error('[dbWorkerClient] monitor 监听器异常:', e)
          }
        }
        return
      }
      if (msg.type === 'result') {
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          p.resolve(msg.result)
        }
      }
    })

    worker.on('exit', (code: number) => {
      console.error('[dbWorkerClient] dbWorker 退出 code=' + code)
      if (this.worker === worker) this.worker = null
      for (const [id, p] of this.pending) {
        if (p.worker !== worker) continue
        this.pending.delete(id)
        p.reject(new Error('数据进程已退出 (code=' + code + ')'))
      }
      for (const listener of this.exitListeners) {
        try { listener() } catch (e) {
          console.error('[dbWorkerClient] exit 监听器异常:', e)
        }
      }
    })

    worker.stdout?.on('data', (d: any) => console.log('[dbWorker stdout]', String(d)))
    worker.stderr?.on('data', (d: any) => console.error('[dbWorker stderr]', String(d)))

    return worker
  }

  call<T = unknown>(type: string, payload: Record<string, unknown> = {}, timeoutMs = 20000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const worker = this.ensure()
      const id = ++this.msgId
      let timer: ReturnType<typeof setTimeout> | null = null

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        this.pending.delete(id)
      }

      timer = setTimeout(() => {
        cleanup()
        reject(new Error('数据进程响应超时 (' + type + ')'))
      }, timeoutMs)

      this.pending.set(id, {
        worker,
        resolve: (v) => { cleanup(); resolve(v as T) },
        reject: (e) => { cleanup(); reject(e) }
      })

      try {
        worker.postMessage({ id, type, payload })
      } catch (e) {
        cleanup()
        reject(e as Error)
      }
    })
  }

  async ping(): Promise<boolean> {
    try {
      const r = await this.call<{ success: boolean }>('ping')
      return r.success === true
    } catch {
      return false
    }
  }

  setPaths(resourcesPath: string, userDataPath: string): Promise<DbWorkerResult> {
    return this.call('setPaths', { resourcesPath, userDataPath })
  }

  open(dbPath: string, key: string, wxid: string): Promise<DbWorkerResult> {
    return this.call('open', { dbPath, key, wxid })
  }

  isReady(): Promise<{ success: boolean; ready: boolean }> {
    if (!this.worker) return Promise.resolve({ success: true, ready: false })
    return this.call('isReady')
  }

  getSessions(): Promise<{ success: boolean; sessions?: any[]; error?: string }> {
    return this.call('getSessions')
  }

  getNewMessages(sessionId: string, since: number, limit = 1000): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    return this.call('getNewMessages', { sessionId, since, limit })
  }

  getContact(username: string): Promise<{ success: boolean; contact?: any; error?: string }> {
    return this.call('getContact', { username })
  }

  getAvatarUrls(usernames: string[]): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    return this.call('getAvatarUrls', { usernames })
  }

  getDisplayNames(usernames: string[]): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    return this.call('getDisplayNames', { usernames })
  }

  getGroupNicknames(chatroomId: string): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    return this.call('getGroupNicknames', { chatroomId })
  }

  execQuery(kind: string, dbPath: string | null, sql: string): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    return this.call('execQuery', { kind, dbPath, sql })
  }

  addMonitorListener(listener: (type: string, json: string) => void): () => void {
    this.monitorListeners.add(listener)
    return () => { this.monitorListeners.delete(listener) }
  }

  startMonitor(listener?: (type: string, json: string) => void): Promise<{ success: boolean }> {
    if (listener) this.monitorListeners.add(listener)
    return this.call('startMonitor')
  }

  setMonitorOptions(autoReconnect: boolean, intervalSeconds: number): Promise<DbWorkerResult> {
    return this.call('setMonitorOptions', { autoReconnect, intervalSeconds })
  }

  close(): Promise<DbWorkerResult> {
    return this.call('close')
  }

  async shutdown(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    try {
      await this.close()
    } catch { /* 尽力关闭：进程可能已退出，dispose 会兜底清理 */ }
    this.dispose(worker)
  }

  dispose(target: ForkableWorker | null = this.worker): void {
    if (!target) return
    if (this.worker === target) this.worker = null
    for (const [id, p] of this.pending) {
      if (p.worker !== target) continue
      this.pending.delete(id)
      p.reject(new Error('数据进程已关闭'))
    }
    try { target.kill() } catch { /* 尽力终止：进程可能已退出 */ }
  }
}

export const dbWorkerClient = new DbWorkerClient()
