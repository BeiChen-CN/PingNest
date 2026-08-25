# PingNest

PingNest 是一个 Windows 桌面端微信通知管理工具。它从本机微信数据层读取新消息，在桌面显示可自定义的通知，并将通知记录保存在本地通知中心中。

> 本项目面向个人本地使用，不属于微信官方客户端或官方接口。

## 功能

- 自动检测微信进程并获取数据库密钥
- 读取微信会话和新消息
- 支持私聊、群聊、公众号等消息类型
- 四种通知样式：标准、紧凑、层叠、极简
- 通知位置、持续时间、透明度、提示音和消息合并设置
- 通知点击跳转到对应会话
- 通知历史按会话整理，支持搜索、日期和消息类型筛选
- 本地静音规则，支持按会话或关键词匹配
- 概览、历史、静音、外观、系统设置和关于页面
- 通知历史使用本地磁盘保存，不上传到远程服务

## 环境要求

- Windows 10 或更高版本
- 64 位 Node.js，建议使用当前 LTS 版本
- 已安装并登录桌面版微信
- 开发和自动配置流程可能需要以管理员身份运行

项目依赖 Windows 原生动态库和微信本地数据结构，实际兼容性会受到微信版本、安装方式和本机权限影响。

## 快速开始

```bash
npm install
npm run dev
```

首次使用时，在应用内完成微信连接配置。自动配置无法读取微信进程时，请确认微信已经启动，并尝试使用相同权限级别或管理员权限启动 PingNest。

## 常用命令

```bash
# 启动开发环境
npm run dev

# TypeScript 类型检查
npm run typecheck

# 运行测试
npm test

# 构建 Windows 安装包
npm run build
```

构建产物会生成到 `release/`，开发构建文件会生成到 `dist/` 和 `dist-electron/`。这些目录已加入 `.gitignore`，不应提交到仓库。

## 项目结构

```text
electron/                  Electron 主进程、IPC、数据服务和原生库 Worker
src/                       React 页面、通知组件和样式
public/                    应用图标及静态资源
resources/                 微信密钥、WCDB 和 Windows 运行时 DLL
tests/                     消息处理、历史分组和通知布局测试
scripts/                   构建辅助脚本
docs/                      UI 规范和设计资料
```

## 数据与隐私

- 通知历史保存在 Electron 用户数据目录中的 `notify-center.json`。
- 通知历史优先使用 Electron `safeStorage` 加密保存；当系统不支持加密时会使用明文回退格式。
- 微信数据库密钥通过 `safeStorage` 加密保存。
- 消息内容、头像和联系人信息只用于本地展示，不会由本项目主动上传。
- 删除通知历史或移除配置前，请确认不再需要相关本地数据。

## 原生资源

发布包依赖以下资源：

- `resources/key/win32/x64/wx_key.dll`
- `resources/wcdb/win32/x64/wcdb_api.dll`
- `resources/wcdb/win32/x64/WCDB.dll`
- `resources/wcdb/win32/x64/SDL2.dll`
- `resources/runtime/win32/` 下的 Visual C++ Runtime DLL

请勿随意替换、重命名或删除这些文件。构建配置会将它们复制到安装包的资源目录并解包原生依赖。

## 故障排查

### 无法获取数据库密钥

1. 确认微信已经启动并完成登录。
2. 确认 PingNest 与微信具有相同的权限级别。
3. 关闭可能拦截进程注入的安全软件后重试。
4. 如果微信版本要求重新登录，请按照应用提示退出并重新扫码登录。

### 无法读取通知历史

确认应用具有用户数据目录的读写权限。历史文件损坏时，应用会保留损坏文件备份并重新创建历史记录。

### 开发构建无法加载原生库

先执行 `npm install`，再执行 `npm run dev`。如果仍然失败，请确认当前系统为 Windows x64，并检查 `resources/` 下的 DLL 是否完整。

## 测试状态

当前测试覆盖：

- 联系人和群聊显示名称
- 消息基线与方向判断
- 历史会话分组和类型归一化
- 通知位置、样式尺寸和多显示器布局
- SQL 消息内容映射

真实微信进程注入、数据库读取和不同微信版本兼容性需要在对应 Windows 环境中单独验证。

## 致谢

感谢 [WeFlow](https://github.com/hicccc77/WeFlow) 提供相关设计思路与具体代码参考。本项目在此基础上结合自身需求进行了适配、重构和界面实现。

## 许可证

本项目采用 [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](LICENSE) 许可证。使用、修改和再发布前请阅读完整许可证文本。
