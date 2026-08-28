import { join, dirname } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { expandHomePath } from '../dbPathService'

/**
 * WCDB 路径探测：DLL 定位、db_storage 解析、session.db / message_*.db 查找。
 * 全部为无状态纯函数（只依赖 fs），便于独立验证。
 */

/** 获取库文件路径（Windows 优先） */
export function getWcdbDllPath(resourcesPath: string | null): string {
  const isMac = process.platform === 'darwin'
  const isLinux = process.platform === 'linux'
  const isArm64 = process.arch === 'arm64'
  const libName = isMac ? 'libwcdb_api.dylib' : isLinux ? 'libwcdb_api.so' : 'wcdb_api.dll'
  const platformDir = isMac ? 'macos' : (isLinux ? 'linux' : 'win32')
  const archDir = isMac ? 'universal' : (isArm64 ? 'arm64' : 'x64')

  const envDllPath = process.env.WCDB_DLL_PATH
  if (envDllPath && envDllPath.length > 0) return envDllPath

  const isPackaged = typeof process['resourcesPath'] !== 'undefined'
  const fallbackResources = isPackaged ? process.resourcesPath : join(process.cwd(), 'resources')
  const roots = [
    process.env.WCDB_RESOURCES_PATH || null,
    resourcesPath || null,
    join(fallbackResources, 'resources'),
    fallbackResources,
    join(process.cwd(), 'resources')
  ].filter(Boolean) as string[]

  const normalizedArch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const relativeCandidates = [
    join('wcdb', platformDir, archDir, libName),
    join('wcdb', platformDir, normalizedArch, libName),
    join('wcdb', platformDir, 'x64', libName),
    join('wcdb', platformDir, libName)
  ]

  for (const root of roots) {
    for (const relativePath of relativeCandidates) {
      const candidate = join(root, relativePath)
      if (existsSync(candidate)) return candidate
    }
  }
  return candidatesFallback(roots, relativeCandidates, libName)
}

/**
 * 兜底路径：所有候选都不存在时，返回首选候选（让 koffi.load 报出完整路径，
 * 便于诊断），完全没有根目录时退回裸库名。
 * 历史遗留：这里曾是嵌套循环但首轮即 return，行为与"取第一个候选"一致。
 */
function candidatesFallback(roots: string[], relativeCandidates: string[], libName: string): string {
  const root = roots[0]
  const relativePath = relativeCandidates[0]
  if (root && relativePath) return join(root, relativePath)
  return libName
}

export function resolveDbStoragePath(basePath: string, wxid: string): string | null {
  if (!basePath) return null
  const normalized = expandHomePath(basePath).replace(/[\\/]+$/, '')
  if (normalized.toLowerCase().endsWith('db_storage') && existsSync(normalized)) return normalized
  const direct = join(normalized, 'db_storage')
  if (existsSync(direct)) return direct
  if (wxid) {
    const viaWxid = join(normalized, wxid, 'db_storage')
    if (existsSync(viaWxid)) return viaWxid
    try {
      const entries = readdirSync(normalized)
      const lowerWxid = wxid.toLowerCase()
      const candidates = entries.filter(entry => {
        try {
          const entryPath = join(normalized, entry)
          if (!statSync(entryPath).isDirectory()) return false
        } catch { return false }
        const lowerEntry = entry.toLowerCase()
        return lowerEntry === lowerWxid || lowerEntry.startsWith(lowerWxid + '_')
      })
      for (const entry of candidates) {
        const candidate = join(normalized, entry, 'db_storage')
        if (existsSync(candidate)) return candidate
      }
    } catch { /* 目录扫描失败，交给后续候选路径 */ }
  }
  try {
    let parent = normalized
    for (let i = 0; i < 2; i++) {
      const up = join(parent, '..')
      if (up === parent) break
      parent = up
      const candidateUp = join(parent, 'db_storage')
      if (existsSync(candidateUp)) return candidateUp
      if (wxid) {
        const viaWxidUp = join(parent, wxid, 'db_storage')
        if (existsSync(viaWxidUp)) return viaWxidUp
      }
    }
  } catch { /* 逐级向上探测失败，返回 null 由调用方报错 */ }
  return null
}

export function findSessionDb(dir: string, depth = 0): string | null {
  if (depth > 5) return null
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (entry.toLowerCase() === 'session.db') {
        const fullPath = join(dir, entry)
        if (statSync(fullPath).isFile()) return fullPath
      }
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      try {
        if (statSync(fullPath).isDirectory()) {
          const found = findSessionDb(fullPath, depth + 1)
          if (found) return found
        }
      } catch { /* 子项不可访问时跳过 */ }
    }
  } catch { /* 目录不可读时视为无 session.db */ }
  return null
}

/** 扫描 db_storage 下所有 message_*.db（微信 4.1.11+ 分表所在） */
export function findMessageDbPaths(dbStoragePath: string): string[] {
  const results: string[] = []
  const scan = (dir: string, depth = 0): void => {
    if (depth > 4) return
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry)
      let st: ReturnType<typeof statSync>
      try { st = statSync(full) } catch { continue }
      if (st.isFile()) {
        const lower = entry.toLowerCase()
        if ((lower.startsWith('msg_') || lower.startsWith('message_')) && lower.endsWith('.db')) {
          if (!results.includes(full)) results.push(full)
        }
      } else if (st.isDirectory()) {
        scan(full, depth + 1)
      }
    }
  }
  scan(dbStoragePath)
  return results
}

export function preloadDependencyPaths(dllPath: string): string[] {
  const dllDir = dirname(dllPath)
  if (process.platform === 'darwin') return [join(dllDir, 'libWCDB.dylib')]
  if (process.platform === 'win32') return [join(dllDir, 'WCDB.dll'), join(dllDir, 'SDL2.dll')]
  return []
}
