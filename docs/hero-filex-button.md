# Hero / 新建会话页的文件图标 + 对话内文件点击（纯插件实现）

## 需求

1. 文件预览 / 编辑图标目前只出现在**有记录的聊天窗口**（注册在
   `conversation.session.header.utilities` 会话标题栏工具位）。希望在
   hero（无会话）和新建聊天窗口（空白会话）也出现，位置在**整个窗口的
   右上角**——即平时聊天窗口里标题栏图标所在的角落。
2. **对话中点击文件**（工具行路径链接、产物文件行、正文文件提及）希望
   直接在编辑器里预览，而不是用系统默认程序打开。

## 为什么不能只用框架现有槽位

- `conversation.session.header` 是严格 `session` 作用域槽位：无 sessionId
  时整个不渲染（`web-react` 的 `strictSessionAbsent`）；空白会话时默认
  头部组件又把整个 header（含 utilities）隐藏（`hideChrome`）。
- hero 上其它槽位都是 single 且已被占用（`conversation.hero.workspace` ←
  ui-workspace，`conversation.hero.agentPreset` ← ui-agent-preset），
  hero 工作区行没有可追加的 list 槽位。

因此**不改动框架代码**（不热补丁 `dsh-client-ui-conversation` bundle），
改为插件自己在框架提供的通用浮层里渲染。

## 实现一：Hero 悬浮图标（`src/client/index.tsx` 的 `HeroFilexButton`）

注册进 `shell.overlay`（框架自带的「全窗口浮层」list 槽位，root 作用域，
任何会话状态都在）：

1. 每 400ms + `resize` 时测量会话列（`document.querySelector('[data-phase]')`，
   ConversationRoot 根节点）的 `getBoundingClientRect()`。
2. 仅当列的 `data-phase === 'hero'`（无会话 hero 或空白会话 hero）时显示；
   进入 `active`（有记录）后自动隐藏——此时标题栏自带的图标接管，不会重复。
3. 定位取 `top: rect.top + 14`、`right: viewportWidth - rect.right + 28`，
   与有记录窗口里标题栏工具位完全一致（header 上边距 12px + 28px 高的按钮
   在 32px 标题行垂直居中 → 14px；右边距 28px）。
4. 渲染同一个 `HeaderGroup`（主按钮 + 模式下拉），点击行为与标题栏一致：
   空白会话绑定该会话（cwd = 其工作区）；完全无会话时给出提示。
5. 不设显式 z-index（`.filex-hero-fab{position:fixed;pointer-events:auto}`），
   在 overlay 层内按 DOM 顺序排在弹窗/提示之下。

## 实现二：对话内文件点击 → 编辑器预览

当前运行时（ui-chat）里，聊天中的一切文件打开都走注入的
`openFile` → `ctx.remote.session.openWorkspacePath`（RPC
`session/openWorkspacePath`，默认用 Host 系统程序打开）；旧运行时走
`ctx.workspaces.openPath`。`apply()` 里把**两条通道都包一层**（
`src/client/openpath-intercept.ts` 的 `wrapOpenPath` /
`wrapOpenWorkspacePath`）：

- 先 `api.fsRead({ sessionId }, path)` 确认会话 cwd 内可读；
- 可读 → `openExplorer(sessionId, path)` 在编辑器弹窗里打开，并返回成功
  （`{ ok: true, value: { opened: true } }`），聊天侧不报错；
- 不可读（目录 / cwd 外）→ 落回原始方法（系统程序打开 / 报错）。

**关键坑**：生成的 remote 面上 `openWorkspacePath` 是**无 setter 的
getter 访问器**（own accessor，`configurable: true`），普通赋值静默失败，
聊天仍会调用原始方法。因此两个 wrapper 都用
`Object.defineProperty` 把属性重定义为数据属性，并在 dispose 时还原原始
描述符（HMR 安全、可链式叠加）。

插件 `inject` 增加 `'remote'`、`'remote.session'`（与 ui-chat 相同，保证
激活顺序）。

## 验证

`scripts/verify.mjs`（本地开发助手：用 `~/.dsh/.credentials.yaml` 签发
浏览器 cookie，驱动 headless Chrome 探测真实 GUI；`--port` 指定当前
GUI 端口）：

- hero 阶段：`.filex-group` 渲染在会话列右上角（`top≈14`、右缘距列右缘
  ≈28px、`z-index:auto`），点击可打开文件预览弹窗；
- 有记录会话：浮层隐藏，标题栏图标照常显示，无重复图标；
- 对话内点击 `fileLink` 文件链接：编辑器弹窗打开并加载该文件（显示
  文件名 + 内容），聊天侧无「打开失败」错误条。

## 部署

web profile 已把 `@dsh-xhl/dsh-file-explorer` 改为 link 到本地工作区
（`link:C:/xhl/agent-work/dsh-file-editor`），`pnpm build` 后新 bundle
直接生效；`dsh web` 的 HMR 轮询会自动热更新，无需重启。
