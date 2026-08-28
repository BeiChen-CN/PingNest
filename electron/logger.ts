/**
 * 主进程统一日志：
 * - 统一格式与级别开关（PINGNEST_LOG_LEVEL=debug|info|warn|error，默认 info）；
 * - 支持命名文件 sink（如 wcdb.log），目录不可写时静默跳过；
 * - debug 级别用于替代空 catch 的静默吞错，便于排障时按级别打开。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

let currentLevel: LogLevel = parseLevel(process.env.PINGNEST_LOG_LEVEL)

function parseLevel(raw: string | undefined): LogLevel {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') return value
  return 'info'
}

function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentLevel]
}

// name -> 已确认可写的目录；不可写时值为 null（之后跳过写文件）
const fileSinks = new Map<string, string | null>()

/** 注册文件 sink；目录创建失败返回 false（调用方可换下一个候选目录）。 */
export function configureFileSink(name: string, dir: string): boolean {
  if (fileSinks.has(name)) return fileSinks.get(name) !== null
  try {
    require('fs').mkdirSync(dir, { recursive: true })
    fileSinks.set(name, dir)
    return true
  } catch {
    fileSinks.set(name, null)
    return false
  }
}

function appendToSink(name: string, line: string): void {
  const dir = fileSinks.get(name)
  if (!dir) return
  try {
    require('fs').appendFileSync(require('path').join(dir, name + '.log'), line + '\n', { encoding: 'utf8' })
  } catch {
    // 文件写入失败不应影响业务，标记 sink 不可用避免重复抛错
    fileSinks.set(name, null)
  }
}

export class Logger {
  constructor(private readonly scope: string, private readonly sink?: string) { }

  debug(...parts: unknown[]): void {
    if (isLevelEnabled('debug')) this.emit('debug', parts)
  }
  info(...parts: unknown[]): void {
    if (isLevelEnabled('info')) this.emit('info', parts)
  }
  warn(...parts: unknown[]): void {
    if (isLevelEnabled('warn')) this.emit('warn', parts)
  }
  error(...parts: unknown[]): void {
    if (isLevelEnabled('error')) this.emit('error', parts)
  }

  private emit(level: LogLevel, parts: unknown[]): void {
    const message = parts.map((part) => {
      if (part instanceof Error) return part.stack || part.message
      if (typeof part === 'object' && part !== null) {
        try { return JSON.stringify(part) } catch { return String(part) }
      }
      return String(part)
    }).join(' ')
    const line = '[ ' + new Date().toISOString() + '] [' + this.scope + '] ' + message

    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)

    if (this.sink) appendToSink(this.sink, line)
  }
}

export function createLogger(scope: string, sink?: string): Logger {
  return new Logger(scope, sink)
}

/** 直写文件 sink（不经控制台与级别过滤），供 wcdb 等自有诊断通道使用 */
export function writeSinkLine(scope: string, sink: string, message: string): void {
  const line = '[ ' + new Date().toISOString() + '] [' + scope + '] ' + message
  appendToSink(sink, line)
}
