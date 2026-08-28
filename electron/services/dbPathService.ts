import { join, basename } from 'path'
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { createDecipheriv } from 'crypto'

export interface WxidInfo {
  wxid: string
  modifiedTime: number
  nickname?: string
  avatarUrl?: string
}

export function expandHomePath(inputPath: string): string {
  const raw = String(inputPath || '').trim()
  if (!raw) return raw
  if (raw === '~') return homedir()
  if (/^~[\\/]/.test(raw)) return homedir() + raw.slice(1)
  return raw
}

/**
 * 清理账号目录名，得到真实 wxid：
 * `wxid_abc_def123` → `wxid_abc`（微信多开目录会带随机后缀）；
 * 普通账号目录 `zhangsan_ab12` → `zhangsan`。
 */
export function cleanAccountDirName(value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed.toLowerCase().startsWith('wxid_')) {
    const match = trimmed.match(/^(wxid_[^_]+)/i)
    return match ? match[1] : trimmed
  }
  const suffixMatch = trimmed.match(/^(.+)_([a-zA-Z0-9]{4})$/)
  return suffixMatch ? suffixMatch[1] : trimmed
}

/**
 * DbPathService（移植自 WeFlow，仅保留 Windows 数据目录发现）
 * 负责发现微信 4.0 数据根目录与账号（wxid_xxx）目录，
 * 并从 global_config 中解析昵称/头像。
 */
export class DbPathService {
  private readVarint(buf: Buffer, offset: number): { value: number, length: number } {
    let value = 0
    let length = 0
    let shift = 0
    while (offset < buf.length && shift < 32) {
      const b = buf[offset++]
      value |= (b & 0x7f) << shift
      length++
      if ((b & 0x80) === 0) break
      shift += 7
    }
    return { value, length }
  }

  private extractMmkvString(buf: Buffer, keyName: string): string {
    const keyBuf = Buffer.from(keyName, 'utf8')
    const idx = buf.indexOf(keyBuf)
    if (idx === -1) return ''
    try {
      let offset = idx + keyBuf.length
      const v1 = this.readVarint(buf, offset)
      offset += v1.length
      const v2 = this.readVarint(buf, offset)
      offset += v2.length
      if (v2.value > 0 && v2.value <= 10000 && offset + v2.value <= buf.length) {
        return buf.toString('utf8', offset, offset + v2.value)
      }
    } catch { }
    return ''
  }

  private parseGlobalConfig(rootPath: string): { wxid: string, nickname: string, avatarUrl: string } | null {
    try {
      const configPath = join(rootPath, 'all_users', 'config', 'global_config')
      if (!existsSync(configPath)) return null

      const fullData = readFileSync(configPath)
      if (fullData.length <= 4) return null
      const encryptedData = fullData.subarray(4)

      const key = Buffer.alloc(16, 0)
      Buffer.from('xwechat_crypt_key').copy(key)
      const iv = Buffer.alloc(16, 0)

      const decipher = createDecipheriv('aes-128-cfb', key, iv)
      decipher.setAutoPadding(false)
      const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()])

      const wxid = this.extractMmkvString(decrypted, 'mmkv_key_user_name')
      const nickname = this.extractMmkvString(decrypted, 'mmkv_key_nick_name')
      let avatarUrl = this.extractMmkvString(decrypted, 'mmkv_key_head_img_url')

      if (!avatarUrl && decrypted.includes('http')) {
        const httpIdx = decrypted.indexOf('http')
        const nullIdx = decrypted.indexOf(0x00, httpIdx)
        if (nullIdx !== -1) avatarUrl = decrypted.toString('utf8', httpIdx, nullIdx)
      }

      if (wxid || nickname) return { wxid, nickname, avatarUrl }
      return null
    } catch {
      return null
    }
  }

  /** 自动检测微信数据库根目录（Windows: Documents/xwechat_files） */
  async autoDetect(): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      const possiblePaths: string[] = []
      const home = homedir()

      if (process.platform === 'darwin') {
        const appSupportBase = join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Library', 'Application Support', 'com.tencent.xinWeChat')
        if (existsSync(appSupportBase)) {
          try {
            const entries = readdirSync(appSupportBase)
            for (const entry of entries) {
              if (/^\d+\.\d+b\d+\.\d+/.test(entry) || /^\d+\.\d+\.\d+/.test(entry)) {
                possiblePaths.push(join(appSupportBase, entry))
              }
            }
          } catch { }
        }
        possiblePaths.push(join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Documents', 'xwechat_files'))
      } else {
        possiblePaths.push(join(home, 'Documents', 'xwechat_files'))
      }

      for (const path of possiblePaths) {
        if (!existsSync(path)) continue
        const accounts = this.findAccountDirs(path)
        if (accounts.length > 0) return { success: true, path }
        if (this.isAccountDir(path)) return { success: true, path }
      }

      return { success: false, error: '未能自动检测到微信数据库目录' }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  findAccountDirs(rootPath: string): string[] {
    const resolvedRootPath = expandHomePath(rootPath)
    const accounts: string[] = []
    try {
      const entries = readdirSync(resolvedRootPath)
      for (const entry of entries) {
        const entryPath = join(resolvedRootPath, entry)
        let stat: ReturnType<typeof statSync>
        try { stat = statSync(entryPath) } catch { continue }
        if (!stat.isDirectory()) continue
        if (!this.isPotentialAccountName(entry)) continue
        if (this.isAccountDir(entryPath)) accounts.push(entry)
      }
    } catch { }
    return accounts
  }

  private isAccountDir(entryPath: string): boolean {
    return (
      existsSync(join(entryPath, 'db_storage')) ||
      existsSync(join(entryPath, 'FileStorage', 'Image')) ||
      existsSync(join(entryPath, 'FileStorage', 'Image2'))
    )
  }

  private isPotentialAccountName(name: string): boolean {
    const lower = name.toLowerCase()
    if (lower.startsWith('all') || lower.startsWith('applet') || lower.startsWith('backup') || lower.startsWith('wmpf')) {
      return false
    }
    return true
  }

  private getAccountModifiedTime(entryPath: string): number {
    try {
      const accountStat = statSync(entryPath)
      let latest = accountStat.mtimeMs
      const dbPath = join(entryPath, 'db_storage')
      if (existsSync(dbPath)) latest = Math.max(latest, statSync(dbPath).mtimeMs)
      const imagePath = join(entryPath, 'FileStorage', 'Image')
      if (existsSync(imagePath)) latest = Math.max(latest, statSync(imagePath).mtimeMs)
      const image2Path = join(entryPath, 'FileStorage', 'Image2')
      if (existsSync(image2Path)) latest = Math.max(latest, statSync(image2Path).mtimeMs)
      return latest
    } catch {
      return 0
    }
  }

  /** 扫描 wxid 列表（按修改时间倒序） */
  scanWxids(rootPath: string): WxidInfo[] {
    const resolvedRootPath = expandHomePath(rootPath)
    const wxids: WxidInfo[] = []
    try {
      if (this.isAccountDir(resolvedRootPath)) {
        const wxid = basename(resolvedRootPath)
        return [{ wxid, modifiedTime: this.getAccountModifiedTime(resolvedRootPath) }]
      }
      const accounts = this.findAccountDirs(resolvedRootPath)
      for (const account of accounts) {
        const fullPath = join(resolvedRootPath, account)
        wxids.push({ wxid: account, modifiedTime: this.getAccountModifiedTime(fullPath) })
      }
    } catch { }

    const sorted = wxids.sort((a, b) => {
      if (b.modifiedTime !== a.modifiedTime) return b.modifiedTime - a.modifiedTime
      return a.wxid.localeCompare(b.wxid)
    })

    const globalInfo = this.parseGlobalConfig(resolvedRootPath)
    if (globalInfo) {
      for (const w of sorted) {
        if (w.wxid.startsWith(globalInfo.wxid) || sorted.length === 1) {
          w.nickname = globalInfo.nickname
          w.avatarUrl = globalInfo.avatarUrl
        }
      }
    }
    return sorted
  }
}

export const dbPathService = new DbPathService()
