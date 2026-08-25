<div align="center">

<img src="public/icon.png" alt="PingNest" width="96" />

# PingNest

**本地优先的 Windows 微信通知中心**

把重要的微信消息带到桌面，用更少的打扰换来更清晰的工作节奏。

<p>
  <a href="https://github.com/BeiChen-CN/PingNest">GitHub</a>
  ·
  <a href="https://github.com/BeiChen-CN/PingNest/issues">问题反馈</a>
  ·
  <a href="CHANGELOG.md">更新日志</a>
  ·
  <a href="LICENSE">许可证</a>
</p>

</div>

> PingNest 面向个人本地使用，不属于微信官方客户端，也不提供微信官方接口。项目通过 Windows 原生能力读取本机微信数据，实际可用性取决于微信版本、安装方式和系统权限。

## 项目定位

PingNest 是一个 Windows 桌面端微信通知管理工具：它监听本机微信的新消息，在桌面展示可自定义的通知，并把通知历史保存到本地通知中心。

它适合希望在工作、学习或全屏应用期间快速掌握微信消息，同时又不想持续切换微信窗口的用户。

## 当前版本亮点

- PingNest 使用新的“消息巢”图标，应用内、任务栏、托盘和安装包保持统一视觉。
- 通知弹窗采用轻量的进入、替换和退出动效；点击、关闭按钮和自动消失都会完整播放离场动画。
- 微信密钥 Hook 与 WCDB 查询运行在独立 Worker 中，降低原生库之间相互污染的风险。
- 原生监控接口不可用时，会自动使用约 2 秒一次的本地轮询作为后备方案。
- 点击通知选择“激活微信窗口”时只负责激活微信主窗口，不模拟微信内部点击；找不到窗口时会回到 PingNest 历史并定位记录。

## 功能一览

### 桌面通知

- 支持私聊、群聊、公众号等消息类型
- 提供标准、紧凑、层叠、极简四种通知样式
- 可调整通知位置、持续时间、透明度、提示音和消息合并方式
- 支持轻盈的进入、替换和退出动画
- 点击通知后可选择：激活微信主窗口、打开 PingNest 通知历史或不执行操作
- 激活微信失败时会自动回到 PingNest 历史，并定位到对应会话记录
- 支持多显示器，并根据光标所在屏幕显示通知

### 通知历史

- 按会话整理历史消息
- 支持联系人、群聊和消息内容搜索
- 支持按日期和消息类型筛选
- 支持复制消息、删除单条记录和清空全部历史
- 页面只展示实际保存的记录数量，不设置或展示固定保存上限

### 静音与范围控制

- 按会话或关键词创建本地静音规则
- 支持“满足任一条件”或“同时满足全部条件”
- 支持所有会话、仅选中会话和排除选中会话三种通知范围
- 规则可以随时启用、停用、编辑或删除

### 系统与连接

- 自动检测微信进程和本地数据路径
- 首次连接时按界面提示完成连接和校验
- 支持重新连接、重新建立 Hook 和删除已保存连接
- 支持开机启动，并默认启动至系统托盘
- 关闭主窗口后可继续驻留托盘接收通知
- 原生库不支持跨项目混用，必须使用与 PingNest 配套的 DLL

## 首次使用

### 运行前准备

1. 使用 Windows 10 或更高版本。
2. 安装 64 位 Node.js，建议使用当前 LTS 版本。
3. 安装并登录桌面版微信。
4. 确保 PingNest 与微信使用相同的权限级别；遇到权限问题时，可尝试以管理员身份启动。

### 连接微信

首次进入连接页面时，请按以下顺序操作：

1. 在微信登录界面先点击 PingNest 的“开始连接”。
2. 然后点击微信界面的“登录”，完成扫码或登录确认。
3. 等待 PingNest 完成检测、连接和校验。
4. 连接成功后进入工作台，消息监听会自动启动。

如果自动连接失败，请先确认微信已经启动并登录，再点击“重新检查”或“重新连接”。

## 安装与开发

```bash
# 安装依赖
npm install

# 启动开发环境
npm run dev
```

开发环境需要在 Windows x64 上运行，因为项目依赖微信相关的 Windows 原生动态库。

### 常用命令

```bash
# TypeScript 类型检查
npm run typecheck

# 运行自动化测试
npm test

# 构建 Windows 安装包
npm run build
```

构建产物位于 `release/`，开发构建文件位于 `dist/` 和 `dist-electron/`。这些目录已被 `.gitignore` 排除，不应提交到仓库。

## 项目结构

```text
electron/
|-- main.ts                         Electron 主进程与应用生命周期
|-- preload.ts                      渲染进程安全桥接
|-- services/                       微信连接、消息监听、配置和本地存储
|-- rules/                          通知规则引擎
`-- windows/                        通知窗口与多显示器布局

src/
|-- components/                     桌面通知组件
|-- features/dashboard/             概览、历史、静音、外观、设置和关于页面
|-- pages/                          应用页面与通知窗口页面
|-- styles/                         全局设计 token 与动效
`-- themes/                         通知主题定义

resources/                         微信密钥、WCDB 和 Windows 运行时 DLL
tests/                             消息、历史分组、名称解析和布局测试
scripts/                           构建辅助脚本
docs/                              UI 规范与设计资料
```

## 数据与隐私

PingNest 的设计原则是本地优先：

- 通知历史保存在 Electron 用户数据目录的 `notify-center.json`。
- 支持时，通知历史使用 Electron `safeStorage` 加密保存；系统不支持加密时会回退为本地明文格式。
- 微信数据库密钥通过 `safeStorage` 加密保存。
- 消息内容、头像、联系人信息和配置不会由 PingNest 主动上传到远程服务。
- 删除通知历史或移除微信连接前，请确认不再需要对应的本地数据。

请注意：PingNest 需要读取本机微信数据，并使用原生动态库建立连接。请仅在你理解并接受这一权限边界的设备上使用。

## 原生资源

发布包需要以下资源保持完整：

```text
resources/key/win32/x64/wx_key.dll
resources/wcdb/win32/x64/wcdb_api.dll
resources/wcdb/win32/x64/WCDB.dll
resources/wcdb/win32/x64/SDL2.dll
resources/runtime/win32/
```

资源用途：

| 文件 | 用途 |
| --- | --- |
| `wx_key.dll` | 注入微信进程并获取数据库密钥 |
| `wcdb_api.dll` | 解密和查询微信 WCDB 数据库 |
| `WCDB.dll`、`SDL2.dll` | WCDB 运行时依赖 |
| `resources/runtime/win32/` | Windows C/C++ 运行时依赖 |

请勿随意替换、重命名或删除这些文件。`electron-builder` 会在构建时将相关资源复制到安装包，并解包需要直接加载的原生依赖。

WeFlow、CipherTalk 或其他项目提供的授权 DLL 不能直接替换 PingNest 配套文件。常见表现包括：

- `AUTH_FAILED:auth_env_missing`
- `操作失败，错误码: -1006`
- `动态库加载失败，请检查安装是否完整 (错误码: -2301)`

遇到以上错误时，请恢复 PingNest 兼容版本的完整 `resources/` 目录，不要混合不同项目的 DLL。

## 故障排查

### 无法检测到微信

- 确认使用的是桌面版微信，而不是网页版或其他客户端。
- 确认微信已经启动并完成登录。
- 确认 PingNest 与微信具有相同的权限级别。
- 关闭可能拦截进程访问或 DLL 加载的安全软件后重试。

### 无法获取数据库密钥

- 按“首次使用”中的顺序操作：先点击 PingNest 的“开始连接”，再点击微信“登录”。
- 如果微信要求重新登录，请按照应用提示完成扫码或登录确认。
- 确认 `resources/key/win32/x64/wx_key.dll` 存在且未被隔离。

### 无法读取通知历史

确认应用具有用户数据目录的读写权限。若历史文件损坏，PingNest 会保留原文件备份并创建新的历史文件；备份文件名会带有 `.corrupt-时间戳` 后缀。

### 开发环境无法加载原生库

```bash
npm install
npm run dev
```

如果问题仍然存在，请确认当前系统为 Windows x64，并检查 `resources/` 下的 DLL 是否齐全。不同微信版本可能需要单独验证兼容性。

## 测试覆盖

当前自动化测试覆盖：

- 联系人、群聊和账号显示名称解析
- 消息基线、消息方向和未读判断
- 私聊与群聊历史会话分组
- 历史消息类型归一化
- 通知位置、样式尺寸和多显示器布局
- SQL 消息内容、撤回消息和媒体消息映射

真实微信进程注入、数据库读取和不同微信版本的兼容性，需要在对应的 Windows 环境中单独验证。

## 贡献与反馈

欢迎通过 [Issues](https://github.com/BeiChen-CN/PingNest/issues) 提交问题或建议。提交问题时，请尽量附上：

- Windows 版本
- 微信版本和安装方式
- PingNest 版本
- 复现步骤和错误信息
- 是否以管理员身份运行

提交代码前建议运行：

```bash
npm run typecheck
npm test
```

## 致谢

感谢 [WeFlow](https://github.com/hicccc77/WeFlow) 提供思路与具体代码参考。PingNest 在此基础上结合自身需求进行了适配、重构和界面实现。

## 许可证

本项目采用 [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](LICENSE) 许可证。使用、修改和再发布前，请阅读完整的许可证文本。
