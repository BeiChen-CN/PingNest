import { app, safeStorage } from 'electron'
import { join } from 'path'
import { NotifyCenterStore } from './notifyCenterCore'

export type {
  NotifyCenterEntry,
  PersistenceStatus,
  NotifyCenterStoreDeps
} from './notifyCenterCore'
export { NotifyCenterStore } from './notifyCenterCore'

/**
 * 生产单例：SQLite（node:sqlite）+ safeStorage 行级加密。
 * 加密语义与旧 JSON 存储一致：写入时加密可用 → enc:，否则按行回退 plain:。
 */
function defaultEncryptText(plain: string): string {
  if (typeof plain !== 'string' || !plain) return plain
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(plain).toString('base64')
    }
  } catch { /* 系统不支持加密时按明文存储（decryptText 侧有对应回退） */ }
  return 'plain:' + plain
}

function defaultDecryptText(stored: string): string {
  if (stored.startsWith('enc:')) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
      }
    } catch (e) {
      console.warn('[NotifyCenterStore] 行解密失败（可能由其他用户/权限写入）:', e)
    }
    return ''
  }
  if (stored.startsWith('plain:')) return stored.slice(6)
  return stored
}

export const notifyCenterStore = new NotifyCenterStore({
  databasePath: join(app.getPath('userData'), 'notify-center.db'),
  legacyFilePath: join(app.getPath('userData'), 'notify-center.json'),
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptText: defaultEncryptText,
  decryptText: defaultDecryptText
})
