# Hero / 新建会话页的文件图标 + 对话内文件点击（纯插件实现）

## 需求

1. 文件预览 / 编辑图标目前只出现在**有记录的聊天窗口**（注册在
   `conversation.session.header.utilities` 会话标题栏工具位）。希望在
   hero（无会话）和新建聊天窗口（空白会话）也出现，位置在**整个窗口的
   右上角**——即平时聊天窗口里标题栏图标所在的角落。
2. **对话中点击文件**（工具行路径链接、产物文件行、正文文件提及）希望
   直接在编辑器里预览，而不是用系统默认程序打开。
3. **打开方式可切换**（编辑器 / 文件夹 / VSCode）：该模式下拉只在
   **hero / 新建会话页**出现；聊天页标题栏保持单一内置编辑器图标不变。

## 为什么不能只用框架现有槽位

- `conversation.session.header` 是严格 `session` 作用域槽位：无 sessionId
  时整个不渲染（`web-react` 的 `strictSessionAbsent`）；空白会话时默认
  头部组件又把整个 header（含 utilities）隐藏（`hideChrome`）。
- hero 上其它槽位都是 single 且已被占用（`conversation.hero.workspace` ←
  ui-workspace，`conversation.hero.agentPreset` ← ui-agent-preset），
  hero 工作区行没有可追加的 list 槽位。

因此**不改动框架代码**（不热补丁 `dsh-client-ui-conversation` bundle），
改为插件自己渲染。

## 实现一：Hero 的打开方式组（`src/client/index.tsx`）

### 新版（0.1.6-alpha.2+）：接管 header 的 corner 座位，与展开按钮并排

新版空白页的 header 不再整体隐藏：`headerBlank` 只是压缩高度，仍铺出
`leading` 与 `corner` 两个座位，且**右侧边栏的展开按钮就注册在
`conversation.session.header.corner`**（single 座位、priority 0）。插件以
**`priority:-1`**（最低 shadowing 优先级，single 座位只有它渲染）接管该
座位，组件内渲染 `HeroGroup`（编辑器 / 文件夹 / VSCode 的 ButtonGroup，
**圆角样式原样保留**）+ 重绘的展开按钮，一行 flex 并排：

```ts
ctx.slots.inject('conversation.session.header.corner', () =>
  ctx.slots.register(
    { name: 'conversation.session.header.corner', priority: -1, label: '文件预览 / 编辑（角落）' },
    (props) => <HeaderCornerGroup sessionId={props.sessionId} />,
  ))
```

- `slots.inject` 自带「等待声明」机制：corner 座位声明一出现才注册，旧版
  （rc.6 无该座位）effect 永不触发，自动回退到下面的 overlay 方案；
- `HeaderCornerGroup` 探测 `utilities` 座位：**有记录会话只显示展开按钮**
  （编辑器图标已在 utilities），空白页显示 ButtonGroup + 展开按钮并排；
- 展开按钮**重绘**（28×28、`IconPanelLeftOutline16`），点击走
  `ctx.get('sidebarRight', false)`（渲染期轮询解析）的 `toggleExpanded()`，
  面板展开时按 `data-sidebar-right-open` 自动隐藏；
- `HeroGroup` 新增可选 `sessionId` prop：corner 座位从 session 标准 kit 拿
  sessionId，overlay 兜底仍用 `useSessions` → `state.current`。

### 旧版（rc.6 及更早）回退：`HeroFilexButton`（shell.overlay 浮层）

注册进 `shell.overlay`（框架自带的「全窗口浮层」list 槽位，root 作用域，
任何会话状态都在）：

1. 每 400ms + `resize` 时测量会话列（`document.querySelector('[data-phase]')`，
   ConversationRoot 根节点）的 `getBoundingClientRect()`。
2. 仅当列的 `data-phase === 'hero'`（无会话 hero 或空白会话 hero）时显示；
   进入 `active`（有记录）后自动隐藏——此时标题栏自带的图标接管，不会重复。
   新版下 `.filex-corner` 渲染时也自动隐藏（两种路径永不重叠）。
3. 定位取 `top: rect.top + 14`、`right: viewportWidth - rect.right + 28`，
   与有记录窗口里标题栏工具位完全一致（header 上边距 12px + 28px 高的按钮
   在 32px 标题行垂直居中 → 14px；右边距 28px）。
4. 渲染 `HeroGroup`（主按钮 + 模式下拉）：
   - 主按钮按当前记忆的模式执行动作（编辑器 → 弹窗；文件夹 → 系统文件
     管理器；VSCode → `code` CLI 打开工作区），默认「编辑器」；
   - 右下拉切换模式：选中即写入 localStorage 并立即执行该动作；
   - 宿主 `fs.capabilities` 探测不到 `code` 时自动隐藏 VSCode 项；
   - 空白会话绑定该会话（cwd = 其工作区）；完全无会话时给出提示。
5. 不设显式 z-index（`.filex-hero-fab{position:fixed;pointer-events:auto}`），
   在 overlay 层内按 DOM 顺序排在弹窗/提示之下。

> 聊天页（`conversation.session.header.utilities`）注册的是 `HeaderIcon`：
> 单个内置编辑器圆按钮（`.filex-header-btn`），不带下拉，行为与升级前一致。

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
GUI 端口）。

**profile test**（0.1.6-alpha.2）实测：

- hero 阶段：`.filex-corner` 内 `HeroGroup`（ButtonGroup，**圆角**：主按钮
  `14px 0 0 14px`、下拉 `0 14px 14px 0`）+ 展开按钮**并排**（均 28×28、
  gap 8px、顶对齐）；下拉含 编辑器 / 文件夹 / VSCode 三项；主按钮点击打开
  文件预览弹窗，展开按钮点击右侧栏展开并隐藏自身；`.filex-hero-fab` 隐藏；
- 有记录会话：corner 只留展开按钮，标题栏 `.filex-header-btn` 单图标照常
  显示（全页仅 1 个文件图标），标题栏内没有 `.filex-group`；
- 对话内点击 `fileLink` 文件链接：编辑器弹窗打开并加载该文件（显示
  文件名 + 内容），聊天侧无「打开失败」错误条。

## 部署

web profile 已把 `@dsh-xhl/dsh-file-explorer` 改为 link 到本地工作区
（`link:C:/xhl/agent-work/dsh-file-editor`），`pnpm build` 后新 bundle
直接生效；`dsh web` 的 HMR 轮询会自动热更新，无需重启。
