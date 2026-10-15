# ARTEX desktop shell（终末地主题版）

这是 ARTEX「终末地主题版」fork 的 **Electron 壳**：一个原生窗口 + 本地技术栈监督（便携 PostgreSQL、ARTEX 后端）。窗口不切换内容 —— 开屏动画在内置 web 应用里（`src/components/boot-sequence.tsx`），壳只负责：

1. 启动便携 PostgreSQL 集群（输出重定向到**文件**，绝不用管道：postgres 子进程会持有管道写端，读端永远等不到 EOF）
2. 用 `artex-llm.env` 的配置启动 `artex.exe`
3. 轮询 `/api/health`，就绪后加载页面并显示窗口
4. 维持上游看门狗契约：子进程 `exit 0` → 退出；`75` → 立即重启（页内更新）；其它 → 退避重试

## 启动失败时不再黑屏

前置检查（安装路径含非 ASCII、目录不可写、缺 MSVC 运行库、缺 `pg_ctl.exe`/`initdb.exe`/`artex.exe`）或 PostgreSQL / 后端任一环节失败时，壳会 `loadFile('diagnose.html')` 显示**中文诊断页**：失败环节、本机检查、日志尾部、「按顺序试这几步」、以及**重试 / 打开安装目录 / 打开后端日志**按钮。

## 端口

| 用途 | 默认 | 覆盖方式 |
|---|---|---|
| HTTP（后端 + 页面） | `8787` | `ARTEX_PORT` 环境变量，或 `shell.json` 的 `port` |
| 流量录制代理 | `8788` | `ARTEX_PROXY_PORT` / `shell.json` 的 `proxyPort` |
| 便携 PostgreSQL | `5433` | `ARTEX_DB_PORT` / `shell.json` 的 `dbPort` |

- `8787` / `8788` 被占用时**自动顺延**到下一个空闲端口
- `5433` 若被**非本程序**占用（用 `psql` 探活判定），自动改用空闲端口并同步 `postgresql.conf` 与 `config.json`（改动前备份 `config.json.bak`）

## 构建

前置：`../payload/{artex,pgsql,node,rea/node_modules}` 必须是已备好的 payload（`extraResources` 从那里取）。

```powershell
cd shell
npm install                                  # 若尚无 node_modules
npx electron-builder --win nsis --x64        # 产物：dist/ARTEX-Endfield-Setup-<version>.exe
```

- `build.win.signAndEditExecutable=false`：绕开 electron-builder 的签名/rcedit 步骤（非管理员环境下 winCodeSign 需要符号链接特权），图标与版本信息改由 `tools/after-pack.js` 用缓存里的 `rcedit-x64.exe` 覆盖。
- 安装包**不含** Ghidra / IDA（深度反编译由用户按需自备）；REA 运行时（`node.exe` + `rea-agents`）随 payload 分发。
- `extraResources` 的 `from` 相对**项目目录**解析，写错会静默跳过（打包日志里会有 `file source doesn't exist`），装出来的包会小得可疑 —— 打完包请核对体积。

## 文件

| 文件 | 作用 |
|---|---|
| `main.js` | 壳主进程：路径解析、启动预检、端口选择、PostgreSQL/后端监督、窗口与诊断页 |
| `preload.js` | 最小 IPC 桥：`shell.info / diagnose / openPath / retry / quit` |
| `diagnose.html` | 启动失败诊断页（自包含，无外部资源） |
| `splash.html` / `splash.css` / `splash.js` | 早期"独立开屏页"方案的遗留资源，当前流程未使用（保留备查） |
| `tools/after-pack.js` | 打包后处理：用 rcedit 写入图标/版本信息 |
| `build/` | 图标源文件（`icon.ico` 会打进 app.asar） |

## payload 里的 MSVC 运行库（打包前必须有）

便携 PostgreSQL 依赖 `vcruntime140.dll` / `vcruntime140_1.dll` / `msvcp140.dll`。构建前把这三个文件放进 `../payload/pgsql/bin/`，它们会随 `extraResources` 进入 `resources\pgsql\bin` —— 这样干净 Windows 上也能直接启动数据库，不必让用户预装 VC++ Redistributable。（`build.files` 只列 `main.js / preload.js / diagnose.html / icon.ico`，payload 走 `extraResources`。）
