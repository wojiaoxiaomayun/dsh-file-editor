/**
 * Client half of dsh-file-explorer.
 *
 * The in-chat session header (`conversation.session.header.utilities`) keeps
 * a single built-in-editor icon: clicking it opens the file-explorer modal
 * (preview / edit).
 *
 * The hero / blank-session open-actions ButtonGroup (编辑器 / 系统文件夹 /
 * VS Code) renders ONLY through the `hero.flex` slot declared by the
 * dsh-hero-flex plugin, which owns the header's corner seat at priority -1
 * and hosts the additive flex row beside the right-sidebar expand button.
 * Without dsh-hero-flex installed the ButtonGroup does not render at all —
 * this plugin no longer occupies the corner seat nor floats a fallback
 * overlay. The left button performs the remembered open action and the right
 * chevron opens a dropdown to switch between them; selecting an entry both
 * persists it as the new default and immediately runs that action.
 *
 * Session binding: every /filex request is conversation-scoped, so the modal
 * must know WHICH session it belongs to — the host resolves the workspace
 * from `session.header.cwd`, never from a global setting. The slot supplies
 * the framework-resolved sessionId; Ctrl+P falls back to the currently
 * selected session (`useSessions` → `state.current`).
 */
import { useEffect, useSyncExternalStore, useState, type JSX } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconEditOutline16,
  IconFolderOpen16,
  Menu,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, FilexSessionListState, FilexUseSessions } from '../context-types.ts'
import { ExplorerModal } from './Explorer.tsx'
import { api } from './api.ts'
import { wrapOpenPath, wrapOpenWorkspacePath, type OpenPathInterceptDeps } from './openpath-intercept.ts'
import { CSS, detectDark, tokenCss } from './style.ts'

/** Services required before mounting. */
export const inject = ['slots', 'sessions', 'workspaces', 'remote', 'remote.session']

/** Which action the hero group's main button performs. */
export type HeaderMode = 'editor' | 'folder' | 'vscode'

const MODE_STORAGE_KEY = 'dsh-file-explorer.header-mode'

interface Store {
  open: boolean
  sessionId: string
  notice: string | null
  /** The hero group's remembered default action. */
  mode: HeaderMode
  /** Whether the host can launch VS Code (probed once per activation). */
  vscode: boolean
  /** Absolute path a chat-side path click asked the modal to open (null = none). */
  pendingPath: string | null
  /** Monotonic seq so a repeated click re-opens the file while the modal stays mounted. */
  pendingSeq: number
}

/** Read the persisted mode; anything unknown defaults to the editor. */
function readStoredMode(): HeaderMode {
  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY)
    if (stored === 'folder' || stored === 'vscode') return stored
    return 'editor'
  } catch {
    return 'editor'
  }
}

/** The official VS Code logo (brand colors), sized like the kit icons. */
function VscodeIcon(props: { size?: number; className?: string }): JSX.Element {
  const { size = 16, className } = props
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden focusable="false" xmlns="http://www.w3.org/2000/svg">
      <path d="M29.01,5.03,23.244,2.254a1.742,1.742,0,0,0-1.989.338L2.38,19.8A1.166,1.166,0,0,0,2.3,21.447c.025.027.05.053.077.077l1.541,1.4a1.165,1.165,0,0,0,1.489.066L28.142,5.75A1.158,1.158,0,0,1,30,6.672V6.605A1.748,1.748,0,0,0,29.01,5.03Z" fill="#0065a9" />
      <path d="M29.01,26.97l-5.766,2.777a1.745,1.745,0,0,1-1.989-.338L2.38,12.2A1.166,1.166,0,0,1,2.3,10.553c.025-.027.05-.053.077-.077l1.541-1.4A1.165,1.165,0,0,1,5.41,9.01L28.142,26.25A1.158,1.158,0,0,0,30,25.328V25.4A1.749,1.749,0,0,1,29.01,26.97Z" fill="#007acc" />
      <path d="M23.244,29.747a1.745,1.745,0,0,1-1.989-.338A1.025,1.025,0,0,0,23,28.684V3.316a1.024,1.024,0,0,0-1.749-.724,1.744,1.744,0,0,1,1.989-.339l5.765,2.772A1.748,1.748,0,0,1,30,6.6V25.4a1.748,1.748,0,0,1-.991,1.576Z" fill="#1f9cf0" />
    </svg>
  )
}

let ctxRef: Context | undefined
let store: Store = { open: false, sessionId: '', notice: null, mode: readStoredMode(), vscode: true, pendingPath: null, pendingSeq: 0 }
const listeners = new Set<() => void>()
let noticeTimer: ReturnType<typeof setTimeout> | undefined

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Store {
  return store
}

/** Live id of the currently selected session; fed by ExplorerOverlay's useSessions subscription. */
let activeSessionId: string | undefined

/** Show a transient warning strip (e.g. "no session to bind the explorer to"). */
function showNotice(text: string): void {
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  store = { ...store, open: false, sessionId: '', notice: text }
  emit()
  noticeTimer = setTimeout(() => {
    if (store.notice === text) {
      store = { ...store, notice: null }
      emit()
    }
  }, 6000)
}

function dismissNotice(): void {
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  store = { ...store, notice: null }
  emit()
}

/** Open the explorer bound to `sessionId`, falling back to the active session. */
function openExplorer(sessionId: string | undefined, path?: string): void {
  const resolved = sessionId !== undefined && sessionId !== '' ? sessionId : activeSessionId
  if (resolved === undefined) {
    showNotice('没有可用的会话：无法确定文件工作区。请先新建/选择一个会话。')
    return
  }
  store = {
    ...store,
    open: true,
    sessionId: resolved,
    notice: null,
    ...(path !== undefined && path !== ''
      ? { pendingPath: path, pendingSeq: store.pendingSeq + 1 }
      : {}),
  }
  emit()
}

/**
 * Resolve the session's authoritative working directory from the host
 * (`session.cwd` reads the session header), falling back to the framework
 * session-list hint only when the host round-trip fails. This keeps
 * reveal / vscode pointing at the session's own workspace even when the
 * session-list snapshot carries no cwd for the bound session.
 */
async function resolveCwdHint(sessionId: string, fallback?: string): Promise<string | undefined> {
  try {
    const result = await api.sessionCwd({ sessionId })
    if (result.cwd !== '') return result.cwd
  } catch {
    // fall through to the hint
  }
  return fallback
}

/** Ask the host to reveal the session's working folder in the OS file manager. */
async function openSystemFolder(sessionId: string | undefined, cwd?: string): Promise<void> {
  const resolved = sessionId !== undefined && sessionId !== '' ? sessionId : activeSessionId
  if (resolved === undefined) {
    showNotice('没有可用的会话：无法确定文件工作区。请先新建/选择一个会话。')
    return
  }
  try {
    const hint = await resolveCwdHint(resolved, cwd)
    const result = await api.fsReveal({ sessionId: resolved }, hint)
    showNotice(`已打开文件夹：${result.cwd}`)
  } catch (error) {
    showNotice(`打开系统文件夹失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Ask the host to open the session's working folder in VS Code. */
async function openInVscode(sessionId: string | undefined, cwd?: string): Promise<void> {
  const resolved = sessionId !== undefined && sessionId !== '' ? sessionId : activeSessionId
  if (resolved === undefined) {
    showNotice('没有可用的会话：无法确定文件工作区。请先新建/选择一个会话。')
    return
  }
  try {
    const hint = await resolveCwdHint(resolved, cwd)
    const result = await api.fsVscode({ sessionId: resolved }, hint)
    showNotice(`已在 VS Code 打开：${result.cwd}`)
  } catch (error) {
    showNotice(`用 VS Code 打开失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Close the modal (session binding stays for the next open). */
function closeExplorer(): void {
  store = { ...store, open: false }
  emit()
}

function setMode(mode: HeaderMode): void {
  if (store.mode === mode) return
  store = { ...store, mode }
  emit()
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // storage unavailable — the choice lives for this page load only
  }
}

/**
 * Probe the host for VS Code availability and hide the VSCode option when the
 * host positively reports it missing (a `{ vscode: false }` answer), so the
 * entry never shows as broken when the CLI is genuinely absent.
 *
 * A FAILED probe is not an answer: the host may simply be mid-reload (its
 * routes vanish for a moment while the bundle is rewritten), and latching
 * "unavailable" then would hide VSCode for the rest of the page's life over a
 * transient hiccup. Failures therefore keep the option visible and retry a few
 * times; picking it without a CLI still surfaces the host's own
 * 「未找到 VS Code 命令行工具」 error, which is the honest report.
 */
function probeVscode(attempt = 0): void {
  void api.fsCapabilities().then((result) => {
    if (result.vscode === false) {
      store = { ...store, vscode: false }
      if (store.mode === 'vscode') store = { ...store, mode: 'editor' }
      emit()
      return
    }
    if (!store.vscode) {
      store = { ...store, vscode: true }
      emit()
    }
  }).catch(() => {
    // Transient failure (host reloading / older host without the endpoint):
    // keep the entry and retry with backoff instead of hiding it.
    if (attempt >= 4) return
    window.setTimeout(() => probeVscode(attempt + 1), 1000 * (attempt + 1))
  })
}

const MODE_ITEMS: MenuEntry[] = [
  { id: 'editor', label: '编辑器', icon: <IconEditOutline16 /> },
  { id: 'folder', label: '文件夹', icon: <IconFolderOpen16 /> },
  { id: 'vscode', label: 'VSCode', icon: <VscodeIcon /> },
]

/** The in-chat header icon: a single built-in-editor entry. */
function HeaderIcon(props: { sessionId?: string }): JSX.Element {
  const title = '文件预览 / 编辑（Ctrl+P）'
  return (
    <Tooltip label={title} side="bottom" delayMs={400}>
      <Button
        type="button"
        className="filex-header-btn"
        size="sm"
        variant="outline"
        icon={<IconEditOutline16 />}
        title={title}
        aria-label="文件预览 / 编辑"
        onClick={(e) => {
          e.stopPropagation()
          openExplorer(props.sessionId)
        }}
      />
    </Tooltip>
  )
}

/**
 * The hero ButtonGroup: the left button carries the remembered mode's icon and
 * runs its action, the right chevron opens the mode dropdown. Rendered only
 * through the `hero.flex` slot declared by the dsh-hero-flex plugin (hero /
 * blank-session header) — the in-chat header keeps the single built-in-editor
 * `HeaderIcon`.
 *
 * `sessionId` comes from the slot's session standard kit; without it the
 * actions fall back to the live selection (`useSessions` → `state.current`)
 * and show a notice when none exists.
 */
function HeroGroup(props: { sessionId?: string; useSessions?: FilexUseSessions }): JSX.Element {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const [menuOpen, setMenuOpen] = useState(false)
  const useSessions = props.useSessions ?? (() => undefined)
  const sessionId = props.sessionId
  // Per-session workspace cwd from the framework session list — a hint for
  // the reveal / vscode actions when the session carries no header cwd.
  const sessionCwd = useSessions(
    (s: FilexSessionListState) => (sessionId !== undefined ? s.byId?.[sessionId]?.cwd : undefined),
  ) as string | undefined
  const mode = state.mode
  const items = state.vscode ? MODE_ITEMS : MODE_ITEMS.filter(item => item.id !== 'vscode')
  const mainIcon = mode === 'folder' ? <IconFolderOpen16 /> : mode === 'vscode' ? <VscodeIcon /> : <IconEditOutline16 />
  const mainTitle = mode === 'folder' ? '打开系统文件夹' : mode === 'vscode' ? '用 VSCode 打开工作区' : '文件预览 / 编辑（Ctrl+P）'

  const onMainClick = (e: { stopPropagation(): void }): void => {
    e.stopPropagation()
    if (mode === 'folder') void openSystemFolder(sessionId, sessionCwd)
    else if (mode === 'vscode') void openInVscode(sessionId, sessionCwd)
    else openExplorer(sessionId)
  }

  return (
    <Tooltip label={mainTitle} side="bottom" delayMs={400}>
      <Menu
        open={menuOpen}
        align="end"
        portal
        compact
        selectedId={mode}
        items={items}
        onSelect={(id) => {
          // 下拉选中：先切换默认模式（主按钮渲染跟随），随后立即执行对应的打开动作。
          const next = id === 'folder' || id === 'vscode' ? id : 'editor'
          setMode(next)
          setMenuOpen(false)
          if (next === 'folder') void openSystemFolder(sessionId, sessionCwd)
          else if (next === 'vscode') void openInVscode(sessionId, sessionCwd)
          else openExplorer(sessionId)
        }}
        onClose={() => setMenuOpen(false)}
        anchor={(
          <div className="filex-group">
            <Button
              type="button"
              className="filex-group-main"
              size="sm"
              variant="outline"
              icon={mainIcon}
              title={mainTitle}
              aria-label={mainTitle}
              onClick={onMainClick}
            />
            <Button
              type="button"
              className="filex-group-trigger"
              size="sm"
              variant="outline"
              title="选择打开方式：编辑器 / 文件夹 / VSCode"
              aria-label="选择打开方式"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }}
            >
              <IconChevronDownOutline14 />
            </Button>
          </div>
        )}
      />
    </Tooltip>
  )
}

/** The overlay entry: keyboard shortcut + modal + transient notice. */
function ExplorerOverlay(props: { useSessions?: FilexUseSessions }): JSX.Element | null {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const useSessions = props.useSessions ?? (() => undefined)
  const current = useSessions((s: FilexSessionListState) => s.current) as string | undefined

  // Keep the module-level "active session" resolver in sync with the live selection.
  useEffect(() => {
    activeSessionId = current
  }, [current])

  // Global shortcut: Ctrl+P opens (or focuses) the explorer for the active session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && typeof e.key === 'string' && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        if (!store.open) openExplorer(undefined)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (state.notice !== null) {
    return (
      <div className="filex-notice" role="alert">
        <span>{state.notice}</span>
        <button type="button" className="filex-notice-btn" aria-label="关闭提示" onClick={dismissNotice}>×</button>
      </div>
    )
  }
  if (!state.open) return null
  if (ctxRef === undefined) return null
  return (
    <ExplorerModal
      ctx={ctxRef}
      scope={{ sessionId: state.sessionId }}
      openFileRequest={state.pendingPath !== null ? { path: state.pendingPath, seq: state.pendingSeq } : null}
      onClose={closeExplorer}
    />
  )
}

/** Plugin body. */
export function apply(ctx: Context): void {
  ctxRef = ctx

  /** Pin a visible diagnostic strip on render/apply failure. */
  const fail = (phase: string, error: unknown): void => {
    console.error(`[dsh-file-explorer] ${phase} error:`, error)
    try {
      const bar = document.createElement('div')
      bar.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483000;max-width:70vw;padding:8px 12px;'
        + 'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f2a1a1;background:#1b1b22;'
        + 'border:1px solid #f2a1a1;border-radius:8px;white-space:pre-wrap'
      bar.textContent = `[dsh-file-explorer] ${phase} error: ${error instanceof Error ? error.message : String(error)}`
      document.body.appendChild(bar)
    } catch {
      // Nothing left to report with.
    }
  }

  try {
    // Inject the stylesheet + syntax token variables once per activation.
    const tagId = 'dsh-file-explorer/styles'
    ctx.effect(() => {
      const dark = detectDark()
      let style = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${tagId}"]`)
      if (style === null) {
        style = document.createElement('style')
        style.dataset.plugin = 'dsh-file-explorer'
        style.dataset.pluginCss = tagId
        document.head.appendChild(style)
      }
      style.textContent = `${CSS}\n${tokenCss(dark)}`
      return () => { style?.remove() }
    }, 'dsh-file-explorer: styles')

    // In-chat header icon (built-in editor only) — right-aligned session utility.
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'file-explorer', order: 10, label: '文件预览 / 编辑' },
        HeaderIcon,
      ))

    // Modal overlay: keyboard shortcut (Ctrl+P), the explorer modal and the
    // transient notice strip — root-scoped, so it works in every session
    // state. (The hero / blank-session ButtonGroup no longer rides this
    // layer; it renders only through dsh-hero-flex's `hero.flex` slot.)
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'file-explorer-overlay', order: 100, label: '文件预览' },
        ExplorerOverlay,
      ))

    // Hero / blank-session open-actions group: rendered ONLY through the
    // `hero.flex` slot that the dsh-hero-flex plugin declares while occupying
    // the header's corner seat (priority -1). `slots.inject` waits for the
    // declaration, so without dsh-hero-flex this entry never mounts and the
    // hero group does not render at all — no corner fight, no fallback.
    ctx.slots.inject('hero.flex', () =>
      ctx.slots.register(
        { name: 'hero.flex', id: 'file-explorer', order: 10, label: '文件预览 / 编辑（hero）' },
        (props: { sessionId?: string; useSessions?: FilexUseSessions }) =>
          <HeroGroup sessionId={props.sessionId} useSessions={props.useSessions} />,
      ))

    // Hide the VSCode option when the host cannot launch it.
    probeVscode()

    // Reroute every chat-side path open — tool-row path links, the
    // produced-files row, and prose file mentions — into the explorer modal
    // instead of the Host OS. Current runtimes funnel those opens through
    // `ctx.remote.session.openWorkspacePath` (ui-chat's injected openFile);
    // `ctx.workspaces.openPath` remains the older funnel and is wrapped too,
    // so both doors are covered. A path outside the session cwd (or
    // unreadable) falls back to the original method, so nothing is silently
    // swallowed.
    ctx.effect(() => {
      const deps: OpenPathInterceptDeps = {
        currentSessionId: () => activeSessionId,
        openInEditor: async (path, sessionId) => {
          try {
            await api.fsRead({ sessionId }, path)
          } catch {
            return false
          }
          openExplorer(sessionId, path)
          return true
        },
      }
      const restoreOpenPath = wrapOpenPath(ctx.workspaces, deps)
      const restoreWorkspacePath = ctx.remote?.session?.openWorkspacePath !== undefined
        ? wrapOpenWorkspacePath(ctx.remote.session, deps)
        : () => {}
      return () => { restoreOpenPath(); restoreWorkspacePath() }
    }, 'dsh-file-explorer: file-open interception')
  } catch (error) {
    fail('load', error)
  }
}
