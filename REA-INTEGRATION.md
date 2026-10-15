# REA 集成说明（ARTEX × REA）

> 本文说明 ARTEX 如何接入 [REA](https://github.com/morluto/rea)（`rea-agents`，MIT）作为逆向分析能力，
> 以及随安装包分发的离线运行时、技能门控与已知限制。适用于 ARTEX 2.2.1 及以后。

## 1. 这是什么

REA 是一个面向"逆向工程一切"的 MCP server + CLI（二进制/APK/固件/JS/EVM 等）。ARTEX 把它当作
**外部 MCP 工具服务器**接入，只做"接入 + 编排 + 展示"，不改造 ARTEX 自身的扫描/利用内核：

| 层 | 内容 |
| --- | --- |
| MCP 服务器 | `mcp_servers` 行 `rea`（stdio）：`resources/node/node.exe` + `resources/rea/node_modules/rea-agents/scripts/rea.mjs mcp` |
| 技能门控 | `skills/reverse-engineer-anything`，frontmatter `mcps: rea`；默认绑定给 `worker` agent |
| 前端页 | 「功能 → 逆向分析」`/function/reverse`：样本上传 → 建任务 → 结论 / 证据 / 工具调用三视图 |
| 离线运行时 | 安装包内置 `node.exe` + `rea-agents` 及其 39 个依赖（约 194 MB 未压缩）；Ghidra/IDA 不内置 |

**合规前提**：只对**自有软件、自有资产或获得明确授权的目标**使用。逆向分析页预置的目标模板已写死
"只读、单文件、不执行、不联网、不利用"。

## 2. 开箱行为

1. 后端启动时 `db.seedBuiltins()` 调用 `seedBundledREA()`：**仅当**
   `<安装目录>\resources\node\node.exe` 与 `<安装目录>\resources\rea\node_modules\rea-agents\scripts\rea.mjs`
   都存在时，才 upsert `mcp_servers` 的 `rea` 行。
2. 该 upsert 会把**陈旧的启动器路径**（例如打包机上的 `C:\Program Files\nodejs\node.exe`）改写为内置路径，
   但命令行已与内置路径一致时不写、也不动用户改过的 `enabled` / 可见性。
3. `builtinSkillVisibility` 把 `reverse-engineer-anything` 默认绑定给 `worker`：REA 的工具因此**处于技能门控态**
   —— 未加载技能前调用会被拦下并提示 *"… is not unlocked in this session — load the skill that provides it first"*，
   加载技能后才解锁。这是**预期行为**，不是故障。
4. 不内置任何密钥：REA 的 provider 通过环境变量（`GHIDRA_INSTALL_DIR`、`JAVA_HOME` 等）可选启用。

## 3. 使用流程（页面）

1. 进入「逆向分析」，确认 REA 卡片显示 `已启用` 与工具数（正常为 **207**）。
2. 「选择样本上传」写入共享工作空间 `uploads/`，或直接填写本机绝对路径。
3. 检查预置的分析目标（要求先加载技能、再调 `mcp__rea__*`、用 `report_finding` 落一条发现、只读不执行）。
4. 「创建分析任务」→ 在「分析任务」表选中它 → 看三个 Tab：
   - **结论**：任务产出的 fact / intent / goal（Markdown 渲染）。
   - **证据文件**：`tasks/<任务 id>/` 下的证据（如 `EVIDENCE_strings.md`、`strings_ascii.json`）。
   - **REA 工具调用**：从 `ExecuteExtraTool` 入参里的 `tool_name` 还原**真实工具名**，并统计调用/失败。
5. 页面第二张卡「**分析引擎（REA provider）**」不用选中任务就可用：它从 REA 失败详情的
   `details.rejections[]` 解析逐引擎诊断，直接显示 Ghidra / IDA / Hopper 的 `code` 与原文原因，并给出启用步骤；
   若检测到的 Java 路径含非 ASCII 字符会额外告警（Ghidra + 中文路径是已知风险面）。没有历史失败记录时显示"尚无诊断"。

## 4. 已知限制与对策

| 现象 | 原因 | 对策 |
| --- | --- | --- |
| `provider_unavailable`（字符串检索、二进制概览等） | 未安装 Ghidra / IDA / Hopper；REA 自身的诊断是 `ghidra: not_configured`（`GHIDRA_INSTALL_DIR` 未设置）、`hopper: unsupported_host win32`、`ida: not_configured` | 需要深度反编译时自行按需安装 Ghidra（约 1 GB）并设置 `GHIDRA_INSTALL_DIR`；**不随包分发** |
| `capability_unavailable`（如 `inspect_with_objdump`） | 该分析不适用于当前目标 | 换分析路径（Agent 通常会自行降级为 Go build info + 符号表解析） |
| `target_unavailable`：*"No app is open…"* | 未先 `open_binary` 就调用 `list_strings` / `search_strings` | 在目标描述里写明"先 `open_binary` 再取字符串" |
| `Input validation error: … format: Invalid option: expected one of "dos-com"\|"raw-binary"` | 延迟 schema 下模型猜错了枚举参数 | 在目标里点明该枚举，或改走 `inspect_*` 系列工具 |
| 首次调用被拒且提示 *not unlocked in this session* | 技能门控（预期） | 让 Agent 先加载技能 `reverse-engineer-anything` |
| 安装路径含中文/空格 | REA 是 Node ESM，路径参与 realpath 与字符串比较 | 安装根保持**纯 ASCII** |

## 5. 许可与署名

- REA（`morluto/rea`）：**MIT**。本仓库 `skills/reverse-engineer-anything/` 为 REA 随包技能的原样副本
  （`SKILL.md` + `reference/`），版权归其作者，保留 MIT 条款；运行时分发的是未修改的 npm 包 `rea-agents@6.5.0`。
- Node.js：**MIT**（内置的 `node.exe` 为官方 Windows x64 构建）。
- ARTEX 本体：AGPL-3.0。MIT 与 AGPL 组合分发时保留上述声明即可。

## 6. 维护提示

- 升级 REA：更新 `payload/rea/node_modules`（`npm install rea-agents@<ver> --prefix <临时目录>` 后整包替换）
  并同步技能目录；注意 `rea-agents` 的 `engines.node`（当前 `^22.19.0 || ^24.11.0 || >=26.0.0`）与内置 `node.exe` 版本匹配。
- 若想**去掉内置 Node**（安装包 −70～85 MB）：把 `rea` 行指向 `ARTEX.exe` 并设 `env = {"ELECTRON_RUN_AS_NODE":"1"}`
  （借 Electron 内嵌 Node），实测握手成功；代价是与 Electron 版本绑定。
- 安装包构建：`cd shell && npx electron-builder --win nsis`（`extraResources` 从 `../payload/*` 取）。
