/**
 * pingnest_monitor.dll 伴生监控库的纯逻辑辅助（无 Node 依赖，便于单测）：
 * 该库用 ReadDirectoryChangesW 监听微信 db_storage 目录，把变更以
 * JSON 行推送到命名管道。管道名由 start() 的第二个参数（suffix）决定，
 * 与 C++ 侧 `\\\\.\\pipe\\pingnest_monitor_%s` 的 sprintf 规则保持一致，
 * 因此 JS 侧无需绑定 pipe_name 查询接口即可算出管道名。
 */

export const MONITOR_PIPE_PREFIX = '\\\\.\\pipe\\pingnest_monitor_'

export function buildMonitorPipeName(suffix: string): string {
  const trimmed = String(suffix || '').trim()
  return MONITOR_PIPE_PREFIX + (trimmed || String(process.pid))
}

/** pingnest_monitor_start 返回码：0=成功；1=已在运行（视为成功）；其余=失败 */
export function isMonitorStartAccepted(rc: number): boolean {
  return rc === 0 || rc === 1
}
