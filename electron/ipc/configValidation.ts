import { configService, type ConfigSchema } from '../services/config'
import { validateConfigValue as validateConfigValuePure } from './configRules'

/**
 * config:set 校验入口：合法键集合来自当前配置 schema，
 * 具体校验规则在 configRules.ts（纯函数，可独立测试）。
 */
export function validateConfigValue(key: keyof ConfigSchema, value: unknown): string | null {
  return validateConfigValuePure(String(key), value, Object.keys(configService.getAll()))
}
