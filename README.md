# DSH File Explorer（编译型插件）

工作区文件预览 / 编辑插件，参照 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 架构的**编译型外部插件**（tsdown 打包，CodeMirror 6 编辑器），由同目录下的动态 Cordis 插件版本移植而来。

## 功能

- **文件列表**：会话标题栏 📄 按钮 / Ctrl+P 打开全屏弹窗，左侧目录树（跳过 `node_modules`/`.git`/`dist` 等）
- **按文件名过滤**：输入即过滤
- **全文搜索**：正则 / 大小写 / 全词匹配、包含/排除过滤，结果按文件分组、命中高亮，点击跳转并高亮匹配
- **编辑**：CodeMirror 6（20+ 语言语法高亮含 Vue SFC、行号、撤销/重做、Ctrl+S 保存、只读切换、Tab 缩进）
- **预览**：图片直接显示、PDF 内嵌查看（Markdown / HTML 预览已移除——大文档渲染会卡死界面）

## 架构

```
src/
  index.ts            Host：/filex/api JSON 路由（session.cwd / fs.list / fs.read / fs.write / fs.search）
                      + /filex/file 媒体路由（图片/PDF 字节），loopback 信任围栏
  trust-fence.ts      Host-header loopback 校验（DNS-rebinding 防护）
  client/
    index.tsx         入口：header 按钮 + overlay 弹窗 + Ctrl+P 快捷键
    Explorer.tsx      弹窗：文件树 / 文件名过滤 / 全文搜索 / 查看器分派
    TextEditor.tsx    CodeMirror 6 编辑器 + 搜索跳转高亮
    lang.ts           扩展名 → CodeMirror 语言映射
    cm-theme.ts       CodeMirror 明暗主题（DSH alias token 驱动）
    api.ts            /filex fetch 封装
    style.ts          界面样式 + 明暗检测
```

## 构建

```bash
pnpm install
pnpm build     # lib/index.js（host）+ lib/client.js（client bundle，CodeMirror 内联）
```

## 安装 / 挂载（desktop profile 示例）

```bash
# 1. profile 依赖 link 本地包
cd ~/.dsh/profiles/desktop
pnpm add dsh-file-explorer@link:C:/xhl/agent-work/dsh-file-editor
# 或手动在 profile package.json 加：
#   "dependencies": { "dsh-file-explorer": "link:C:/xhl/agent-work/dsh-file-editor" }
#   "dsh": { "profile": { "bundles": [..., "dsh-file-explorer"] } }

# 2. 安装依赖
pnpm install

# 3. 验证组合生效（应看到 dsh-file-explorer 行）
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
