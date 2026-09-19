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

### 现在（0.1.9+，独立插件化）：只经 `hero.flex` 槽位渲染

hero 右上角 flex 已抽成独立插件 **`@dsh-xhl/dsh-hero-flex`**：它接管
`conversation.session.header.corner`（single 座位、**priority -1**，最低
shadowing 优先级 → 替换 shell 自带的右侧栏展开按钮及其它占用者），并在
注册时通过 `children: { 'hero.flex': { kind: 'list', scope: 'session' } }`
声明一个**插件可追加**的 `hero.flex` 子槽位，渲染一行：

```
[ hero.flex 槽位条目 ] [ 重绘的右侧栏展开按钮 ]
```

本插件的 `HeroGroup`（编辑器 / 文件夹 / VSCode 的 ButtonGroup）只注册进
`hero.flex`：

```ts
ctx.slots.inject('hero.flex', () =>
  ctx.slots.register(
    { name: 'hero.flex', id: 'file-explorer', order: 10, label: '文件预览 / 编辑（hero）' },
    (props) => <HeroGroup sessionId={props.sessionId} useSessions={props.useSessions} />,
  ))
```

- `slots.inject` 自带「等待声明」机制：**只有 hero-flex 安装并声明
  `hero.flex` 时才会注册**；未安装 hero-flex 时 effect 永不触发，
  hero 组不显示——这正是“没注入这个插件，hero 也不显示”的预期行为。
- 条目是 `session` 作用域：自动获得标准 session kit（`sessionId`、
  `useSession`、`useSessions` 等）。
- 有记录会话时 header 的 `utilities` 座位渲染，hero.flex 条目自动隐藏
  （只留重绘的展开按钮），避免与标题栏功能图标重复。

> 本插件**不再**占用 `conversation.session.header.corner`（旧版 priority
> -1 / 回退 -0.5 已移除），也**不再**通过 `shell.overlay` 浮层绘制 hero
> 按钮（旧版 `HeroFilexButton` 已删除）。相关样式 `.filex-corner` /
> `.filex-corner-expand` / `.filex-hero-fab` 一并移除。

### 历史（0.1.6-0.1.8）：插件自身接管 corner 座位

旧版空白页的 header 不再整体隐藏：`headerBlank` 只是压缩高度，仍铺出
`leading` 与 `corner` 两个座位，且**右侧边栏的展开按钮就注册在
`conversation.session.header.corner`**（single 座位、priority 0）。插件以
**`priority:-1`**（最低 shadowing 优先级，single 座位只有它渲染）接管该
座位，组件内渲染 `HeroGroup` + 重绘的展开按钮，一行 flex 并排。该方案在
插件化之后移除，由 dsh-hero-flex 统一承担。

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

**profile test（0.1.9，插件化后）实测/预期**：

- 安装 `@dsh-xhl/dsh-hero-flex`：hero / 空白会话页右上角为
  `[文件按钮组][展开按钮]` 并排（`.hf-row`，均 28×28、gap 8px）；按钮组
  主按钮点击打开文件预览弹窗，下拉含 编辑器 / 文件夹 / VSCode 三项；
  展开按钮点击右侧栏展开并隐藏自身；
- **不安装** `@dsh-xhl/dsh-hero-flex`：hero / 空白会话页**不显示**文件
  按钮组（没有浮层、没有 corner 回退）；有记录会话的标题栏
  `.filex-header-btn` 单图标照常显示；
- 有记录会话：hero.flex 条目自动隐藏（只留展开按钮），标题栏
  `.filex-header-btn` 单图标照常显示（全页仅 1 个文件图标）；
- 对话内点击 `fileLink` 文件链接：编辑器弹窗打开并加载该文件（显示
  文件名 + 内容），聊天侧无「打开失败」错误条。

## 部署

web profile 已把 `@dsh-xhl/dsh-file-explorer` 改为 link 到本地工作区
（`link:C:/xhl/agent-work/dsh-file-editor`），`pnpm build` 后新 bundle
直接生效；`dsh web` 的 HMR 轮询会自动热更新，无需重启。
