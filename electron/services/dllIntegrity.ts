import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'

/**
 * 原生资源完整性校验：对照构建期生成的 resources/dll-manifest.json（SHA256）
 * 逐个校验将要加载的 DLL，任何不匹配都拒绝加载。
 * 清单由 scripts/prepare-electron-runtime.cjs 在 postinstall/dev/build 时重算。
 */

export interface ResourceVerification {
  ok: boolean
  detail?: string
}

export function formatIntegrityError(detail: string): string {
  return '原生库完整性校验失败（' + detail + '）。\n\n安装文件可能被篡改或损坏：\n1. 请从官方发布渠道重新下载并安装 PingNest\n2. 不要手动替换或混用其他项目的 DLL'
}

/** 校验 manifest 中登记的单个文件；校验失败（含清单/文件缺失）返回 ok=false + 面向用户的 detail。 */
export function verifyResourceFile(manifestPath: string, manifestKey: string, filePath: string): ResourceVerification {
  try {
    if (!existsSync(manifestPath)) {
      return { ok: false, detail: '完整性清单不存在: ' + manifestPath }
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files?: Record<string, string> }
    const files = manifest.files || {}
    const expected = files[manifestKey]
    if (!expected) {
      return { ok: false, detail: '清单缺少条目: ' + manifestKey + '（请重新运行 npm install 生成清单）' }
    }
    if (!existsSync(filePath)) {
      return { ok: false, detail: '文件不存在: ' + filePath }
    }
    const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex')
    if (actual !== expected.toLowerCase()) {
      return { ok: false, detail: manifestKey + ' SHA256 不匹配（预期 ' + expected.slice(0, 12) + '…，实际 ' + actual.slice(0, 12) + '…）' }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: '校验过程异常: ' + String((e as Error)?.message || e) }
  }
}
