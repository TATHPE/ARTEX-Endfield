# Endfield 主题版（本 fork 的改动说明）

本仓库是 [`RuoJi6/ARTEX`](https://github.com/RuoJi6/ARTEX) 的 fork，除了上游功能外，额外做了**终末地（Arknights: Endfield）风格的界面与开屏流程**。上游功能与 API 完全保留，本文只说明**我们改了什么、怎么构建、怎么运行**。

> 设计基准来自第三方研究性图谱 `weepwood.github.io/arkfield-design-atlas` 的实测令牌（主黄 `#F4ED17`、结晶蓝 `#57BACD`、近黑 `#111416`/`#151719`、暖白 `#E8E8E2`/`#F3F3ED`、次要 `#646766`、分割线 `rgba(20,23,25,.17)`）。它是**风格基准，不是官方品牌规范**。

## 一、改动清单（主题部分全部在 `web/`；v2.2.2 起 fork 另含壳与后端安全修复，见 README / CHANGELOG）

| 文件 | 作用 |
| --- | --- |
| `web/src/styles/presets/endfield.css` | **新增**：终末地令牌预设。圆角全 0、阴影全 none；**按表面分治**——纸底（浅色）时 `--primary` 用近黑，主黄只作标记/焦点/危险条纹；墨底（深色）时 `--primary` 才是主黄；`--accent` 保持为 hover 底色（不是品牌色） |
| `web/src/styles/endfield-skin.css` | **新增**：皮肤层（约 570 行）。颗粒 + 扫描线漂移、切角面板、卡片四角十字定位标、面板顶部黄黑危险条纹、侧栏活动项黄色导轨 + 脉冲点、等宽读数、按钮大写等宽与按下位移、焦点黄描边、进度条扫光、骨架斜纹、虚线刻度、徽标间歇闪；含 `prefers-reduced-motion` |
| `web/src/components/boot-sequence.tsx` + `web/src/styles/boot-sequence.css` | **新增**：**开屏动画**（内嵌在应用窗口内，预渲染首帧）。节奏移植自 [`rison114514/grad-research-workbench`](https://github.com/rison114514/grad-research-workbench) 的 `boot-sequence.js`：Logo 滑入 → 左侧竖向黄色加载柱 + 计数器（`000→100`，数字块沿轨道下移）+ 状态文案切换 → `READY` → 全屏黄幕揭幕。身份区 = 项目 Logo × 三角徽标（保留「终末地 / ENDFIELD INDUSTRIES」锁标） |
| `web/src/components/workbench-loader.tsx` + `web/src/styles/workbench-loader.css` | **新增**：**登录后的工作台加载页**（同样在窗口内）。左上 ARTEX 标识、巨型描边水印、三角徽标（此处文字为 **ARTEX**）、左侧轨道、`TIPS` 轮播、底部**会动的进度条** + `NOW LOADING...`、左下 `{耗时}ms` 与 `UID`。**仅在密码登录成功后播一次**（登录页/首次设密页写入 `artex_show_workbench_loader` 标记，播完即清）；普通启动只播开屏动画 |
| `web/src/lib/fonts/registry.ts` + `web/src/lib/fonts/endfield/*.woff2` | **新增/修改**：自托管 **Barlow Condensed**（4 档）与 **DM Mono**（3 档）——图谱只有这两条字体栈。woff2 已入库，构建**不需要联网**取字体 |
| `web/src/lib/preferences/preferences-config.ts` | 默认预设/字体切到 `endfield` |
| `web/src/lib/preferences/theme.ts` | 由 `npm run generate:presets` 生成的 Endfield 预设条目（**别手改**） |
| `web/src/app/globals.css`、`web/src/app/layout.tsx`、`web/src/app/(main)/layout.tsx`、`(auth)/login/page.tsx`、`(auth)/setup/page.tsx` | 引入上面两个覆盖层与皮肤；登录/首次设密成功后打「播一次加载页」的标记 |
| `web/src/components/penguin-backdrop.tsx` + `web/src/app/(main)/_components/sidebar/layout-controls.tsx` | **v2.2.2 起**：右下角企鹅水印可在 **设置 →「界面」** 隐藏。`config.json` 的 `ui.hide_penguin` 只是部署默认值，用户切换后写库（`GET/PUT /api/ui-config`）；隐藏时只移除企鹅本体，`body::before/::after` 与侧栏透明的两条常驻规则必须保留（否则扫描线/颗粒会回来） |

上游另外三套主题预设（`brutalist` / `soft-pop` / `tangerine`）**保留可用**。

## 二、构建（Windows 实测）

```powershell
# 0) 依赖（首次约 9 分钟；husky prepare 报 .git can't be found 可忽略）
cd web; npm ci

# 1) 前端静态导出（注意：上游的 build:static 是 bash 语法，Windows 下必须这样跑）
$env:NEXT_EXPORT='1'; node_modules\.bin\next.cmd build      # 产物 web/out

# 2) 拷进内嵌目录（等价上游 build.sh 的 rsync --delete）
rmdir /s /q server\webui\dist & mkdir server\webui\dist
xcopy /E /I /Y web\out\* server\webui\dist\

# 3) 编译带界面内嵌的单二进制（需 Go；本机用便携版 go1.27.2）
$env:CGO_ENABLED='0'
go build -tags embedui -trimpath -ldflags "-s -w -buildid= -X main.version=<版本>" -o artex.exe ./cmd/artex
```

> Go 依赖：本机 `proxy.golang.org` 不通，请设 `GOPROXY=https://goproxy.cn,direct`（`GOSUMDB=off` 即可，`go.sum` 已提供完整性）。

## 三、桌面窗口版（壳源码见 `shell/`）

仓库只产出 `artex.exe`（含内嵌界面）。如果希望**双击就弹独立窗口**而不是浏览器标签，需要外层的 Electron 壳 + NSIS 安装包（本 fork 的发行用），它做三件事：起便携 PostgreSQL → 起 `artex.exe`（注入 `artex-llm.env` 里的 LLM 配置）→ 等 `/api/health` 就绪后加载界面。壳源码自 2026-10-15 起已纳入本仓库的 `shell/`（`main.js` / `preload.js` / `diagnose.html` / `installer.nsh`），构建：`npx electron-builder --win nsis --x64`。

⚠️ **打包后的 Electron 应用不能放在非 ASCII 路径**（中文目录下会启动即退、不留日志）。**安装/解压路径请保持纯 ASCII**（例如 `D:\artex-win` 或 `%LOCALAPPDATA%\Programs\ARTEX`）。

## 四、运行

```powershell
# 方式一：用 start.bat（守护脚本：退出码 0 退出 / 75 立即重启（页面一键更新）/ 其它退避重启）
.\start.bat

# 方式二：直接跑（不推荐，页面一键更新后不会被拉起）
.\artex.exe

# 首次运行
#   - 需要 PostgreSQL；浏览器打开 http://localhost:8787 会进入 /setup 设置管理员密码
#   - LLM：设置 ANTHROPIC_API_KEY / OPENAI_API_KEY（或 UI 的「LLM 配置」页）
#     可选 ARTEX_LLM_PROVIDER / ARTEX_LLM_MODEL / ARTEX_LLM_BASE_URL / ARTEX_LLM_PROXY
```

## 五、密钥与口令的处理（本 fork 的发行约定）

分发出去的包里**不含任何密钥或口令**：

- **不含** `artex-llm.env`（LLM 密钥只存在于使用者的本机，模板见 `artex-llm.env.example`）；
- **不含** `config.json`（数据库连接在首次运行时生成；本地实例用 `127.0.0.1` 直连）；
- **不含** `ADMIN-PASSWORD.txt` / `data\`（JWT key）/ 日志；
- **管理员密码为空**：数据库首次初始化，因此打开界面就是 `/setup`，由使用者自己设密码。

## 六、与上游同步

主题改动最初是单个提交，落在 `endfield-theme` 分支上；v2.2.2 的壳与安全修复在同一分支上追加了多个提交：

```powershell
git fetch origin
git rebase origin/main endfield-theme     # 主题提交冲突面很小，壳/安全提交按需逐个处理
```

推送到 fork 时注意：如果分支带上了改动 `.github/workflows/*` 的历史提交，GitHub 会要求 PAT 具备 **workflow** 权限；把提交 rebase 到 fork 自己的 `main` 之上即可规避（只需 `Contents: Read and write`）。

## 七、许可与免责

上游为 AGPL-3.0（见 `LICENSE`），本 fork 沿用。ARTEX 是**自主渗透测试**工具——**只对你拥有或已获授权**的目标使用。终末地相关名称与素材权益归鹰角网络等权利人；本仓库只做**风格致敬**，不包含游戏素材。
