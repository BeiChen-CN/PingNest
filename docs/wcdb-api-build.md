# 构建自有 `wcdb_api.dll`

`Tencent/WCDB` 不是 PingNest 的 `wcdb_api.dll`。前者是数据库框架，后者是本项目约定的 C ABI 适配层，另外还承担微信数据库打开、JSON 转换和内存释放。把 Tencent/WCDB 编译出来的 DLL 直接改名，不能解决 `-1006`，也不会导出应用需要的接口。

## 推荐边界

- 使用 Tencent/WCDB 作为数据库内核，按其许可证编译。
- 在单独的 `wcdb_api` wrapper 中实现下面的导出函数。
- 使用项目自己的密钥输入和数据库路径；不要复制 WeFlow 的 `InitProtection`、宿主校验或授权逻辑。
- `wx_key.dll` 负责获取密钥，和 `wcdb_api.dll` 是两个独立组件。

## 必需 ABI

Windows x64、C calling convention、UTF-8 字符串：

```c
int32_t wcdb_init(void);
int32_t wcdb_shutdown(void);
int32_t wcdb_open_account(const char *session_db_path,
                          const char *hex_key,
                          int64_t *out_handle);
void    wcdb_free_string(void *ptr);
int32_t wcdb_get_sessions(int64_t handle, void **out_json);
int32_t wcdb_get_messages(int64_t handle, const char *username,
                          int32_t limit, int32_t offset, void **out_json);
int32_t wcdb_get_message_count(int64_t handle, const char *username,
                               int32_t *out_count);
int32_t wcdb_get_display_names(int64_t handle, const char *usernames_json,
                               void **out_json);
int32_t wcdb_get_avatar_urls(int64_t handle, const char *usernames_json,
                             void **out_json);
```

所有返回 `void **out_json` 的函数都必须用同一 DLL 的堆分配内存，并由 `wcdb_free_string` 释放。返回内容是 UTF-8 JSON；错误返回非零 `int32_t`。游标、群昵称和联系人接口是可选的，缺少时 PingNest 会使用基础消息接口或返回可读错误。

## Windows 构建流程

1. 安装 Visual Studio 2022 的 **Desktop development with C++**、Windows 10/11 SDK、CMake 和 Ninja。
2. 在 **x64 Native Tools Command Prompt** 中获取 Tencent/WCDB 源码并按其文档先构建静态库或导入库。
3. 创建 wrapper 的 CMake 工程，链接 WCDB 目标和必要的 SQLite/加密依赖，并为导出函数添加 `extern "C" __declspec(dllexport)`；目标必须是 `x86_64`/`Release`。
4. 生成并构建：

   ```powershell
   cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
   cmake --build build --config Release
   ```

5. 将生成的 `wcdb_api.dll` 与它实际链接的 `WCDB.dll`、运行库放在同一个目录。不要混用 WeFlow、密语/CipherTalk 或其他项目的二进制依赖。

## 导出检查

```powershell
dumpbin /exports build\Release\wcdb_api.dll
```

至少应看到上面列出的 9 个符号。使用 `koffi` 调用 `wcdb_init()`、打开一个测试数据库并执行 `wcdb_free_string()`，确认返回值和内存所有权后再复制到 `resources/wcdb/win32/x64/`。

`InitProtection` 不属于自有 ABI 的必需项。PingNest 会对缺少该符号的 legacy 构建执行基础 ABI 检查；受保护的 WeFlow DLL 仍会在 `wcdb_init()` 阶段返回 `-1006`，不能通过修改 `CompanyName`、`ProductName`、系统时间或宿主进程来绕过。
