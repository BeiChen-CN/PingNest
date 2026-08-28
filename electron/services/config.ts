import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { DEFAULT_CONFIG, type AppConfig, type NotificationClickBehavior, type NotificationFilterMode, type NotificationPosition, type NotificationStyle, type NotifyRule } from '../../shared/appConfig'

// 配置类型与默认值统一维护在 shared/appConfig.ts，这里只保留持久化与加解密逻辑。
export type { AppConfig as ConfigSchema, NotificationClickBehavior, NotificationFilterMode, NotificationPosition, NotificationStyle, NotifyRule }

type ConfigSchema = AppConfig

/** 对外下发的配置副本：脱敏掉密钥明文。 */
export function getPublicConfig(cfg: ConfigSchema): ConfigSchema {
  return { ...cfg, decryptKey: '' }
}

const DEFAULTS: ConfigSchema = DEFAULT_CONFIG

// 敏感字段：decryptKey 用 safeStorage 加密存储
const ENCRYPTED_KEYS = new Set(['decryptKey'])

function encryptValue(key: string, value: unknown): unknown {
  if (!ENCRYPTED_KEYS.has(key)) return value
  if (typeof value !== 'string' || !value) return value
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(value).toString('base64')
    }
  } catch { }
  return value
}

function decryptValue(key: string, value: unknown): unknown {
  if (!ENCRYPTED_KEYS.has(key)) return value
  if (typeof value !== 'string') return value
  if (value.startsWith('enc:')) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
      }
    } catch (e) {
      console.warn('[ConfigService] ' + key + ' 解密失败（可能由管理员权限写入）:', e)
    }
    return ''
  }
  return value
}

export class ConfigService {
  private static instance: ConfigService
  private store: any

  private constructor() {
    this.store = new Store({
      name: 'config',
      defaults: DEFAULTS as unknown as Record<string, unknown>
    })
  }

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService()
    }
    return ConfigService.instance
  }

  get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] {
    const raw = this.store.get(key as string)
    return decryptValue(key as string, raw) as ConfigSchema[K]
  }

  set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
    this.store.set(key as string, encryptValue(key as string, value))
  }

  getCacheBasePath(): string {
    return app.getPath('userData')
  }

  getAll(): ConfigSchema {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(DEFAULTS) as (keyof ConfigSchema)[]) {
      result[key] = this.get(key)
    }
    return result as unknown as ConfigSchema
  }

  clear(): void {
    this.store.clear()
  }
}

export const configService = ConfigService.getInstance()
