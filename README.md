# DSH File Explorer（编译型插件）

工作区文件预览 / 编辑插件，参照 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 架构的**编译型外部插件**（tsdown 打包，CodeMirror 6 编辑器），由同目录下的动态 Cordis 插件版本移植而来。

## 功能

- **聊天页标题栏图标**（`conversation.session.header.utilities`）：一个内置编辑器图标，点击打开文件预览 / 编辑弹窗（聊天页保持与现状一致，无下拉）
- **Hero / 新建会话页 ButtonGroup**：通过 `@dsh-xhl/dsh-hero-flex` 插件声明的
  `hero.flex` 槽位渲染（**未安装该插件则不显示**）；hero 上为**左主按钮 +
  右下拉**的组合：
  - **编辑器**（默认）：点击打开文件预览 / 编辑弹窗（Ctrl+P 亦可）
  - **文件夹**：点击直接打开会话工作区所在的**系统文件夹**（Windows `explorer` / macOS `open` / Linux `xdg-open`）
  - **VSCode**：点击用 `code` 命令行在 **VS Code** 中打开会话工作区（自动探测安装位置 / PATH；宿主明确报告未安装时该项自动隐藏，探测请求本身失败则保持可见并退避重试）
  - 选择记忆在 localStorage，点击后底部提示确认打开的路径；下拉选中某项会先切换默认打开方式，随后立即执行对应的打开动作
  - 纯插件实现，不改动框架代码；hero 按钮组渲染依赖独立插件 `@dsh-xhl/dsh-hero-flex`（详见 `docs/hero-filex-button.md`）
- **对话内点击文件 → 编辑器预览**：聊天里的文件路径链接（工具行、产物行、正文提及）默认用系统程序打开；插件拦截 `remote.session.openWorkspacePath` 与 `workspaces.openPath` 两条通道，改为在编辑器弹窗中预览（目录或 cwd 外的路径仍落回系统打开）
- **文件列表**：左侧目录树（跳过 `node_modules`/`.git`/`dist` 等）
- **按文件名过滤**：输入即过滤
- **全文搜索**：正则 / 大小写 / 全词匹配、包含/排除过滤，结果按文件分组、命中高亮，点击跳转并高亮匹配
- **编辑**：CodeMirror 6（20+ 语言语法高亮含 Vue SFC、行号、撤销/重做、Ctrl+S 保存、只读切换、Tab 缩进）
- **预览**：图片直接显示、PDF 内嵌查看（Markdown / HTML 预览已移除——大文档渲染会卡死界面）
- **全屏**：弹窗标题栏的全屏按钮，一键把预览 / 编辑弹窗放大到整个窗口（图标转为「退出全屏」，再点一次还原）
- **界面**：复用 Web 壳设计系统（`@deepseek-ai/dsh-client-ui-primitives`：Button / Menu / Modal / Input / Toast / Tooltip + `--dsw-*` token），随主题明暗自适应

## 架构

```
src/
  index.ts            Host：/filex/api JSON 路由（session.cwd / fs.list / fs.read / fs.write / fs.search / fs.reveal / fs.vscode / fs.capabilities）
                      + /filex/file 媒体路由（图片/PDF 字节），loopback 信任围栏
  trust-fence.ts      Host-header loopback 校验（DNS-rebinding 防护）
  client/
    index.tsx         入口：聊天页 header 图标（内置编辑器）+ hero 模式 ButtonGroup（hero.flex 槽位）+ overlay 弹窗 + Ctrl+P 快捷键
    Explorer.tsx      弹窗：文件树 / 文件名过滤 / 全文搜索 / 查看器分派（primitives 重排）
    TextEditor.tsx    CodeMirror 6 编辑器 + 搜索跳转高亮
    lang.ts           扩展名 → CodeMirror 语言映射
    cm-theme.ts       CodeMirror 明暗主题（DSH alias token 驱动）
    api.ts            /filex fetch 封装
    style.ts          布局样式（仅弹窗布局/树/搜索行等自有部分）+ 明暗检测
```

## 构建

```bash
pnpm install
pnpm build     # lib/index.js（host）+ lib/client.js（client bundle，CodeMirror 内联）
```

> 构建采用**原地覆盖**（不再先删除 `lib/`）。宿主半在进程启动时载入内存，而 profile
> 若 link 到本工作区则会直读磁盘：构建中途清空目录会让 HMR 读到空 bundle，导致
> `/filex` 路由与客户端 import 瞬时失败（表现为 `unknown filex API method ...`）。
> 改动客户端后无需重启，宿主半的改动需重启 DSH 进程。

## 安装 / 挂载（desktop profile 示例）

```bash
# 0. 从 npm 安装已发布的包（或见下方本地 link 方式）
cd ~/.dsh/profiles/desktop
pnpm add @dsh-xhl/dsh-file-explorer
# 并手动在 profile 的 dsh.profile.bundles 加： "@dsh-xhl/dsh-file-explorer"

# 1. 本地开发：profile 依赖 link 本地包
cd ~/.dsh/profiles/desktop
pnpm add @dsh-xhl/dsh-file-explorer@link:C:/xhl/agent-work/dsh-file-editor
# 或手动在 profile package.json 加：
#   "dependencies": { "@dsh-xhl/dsh-file-explorer": "link:C:/xhl/agent-work/dsh-file-editor" }
#   "dsh": { "profile": { "bundles": [..., "@dsh-xhl/dsh-file-explorer"] } }

# 2. 安装依赖
pnpm install

# 3. 验证组合生效（应看到 @dsh-xhl/dsh-file-explorer 行）
dsh --profile desktop --dump-config

# 4. 重启 DSH（host 半必须重启加载）
```

> 旧版动态插件源码保留在 `plugin/host.js` / `plugin/client.js`（cordis_define 用），
> 新编译型版本为 `src/`。

## 与动态插件版本的区别

| | 动态插件（旧） | 编译型插件（新） |
|---|---|---|
| 编辑器 | 自研轻量高亮（透明 textarea + pre 覆盖） | **CodeMirror 6** |
| 语法高亮 | 自研 tokenizer | 20+ 官方语言包 |
| 构建 | 无（运行时定义） | tsdown 打包（lib/） |
| 沙箱 | 动态 Client 沙箱（无 import、定时器受限） | 无沙箱，完整浏览器/Node API |
