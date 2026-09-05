/**
 * Client half of dsh-file-explorer: a header ButtonGroup that opens either
 * the file-explorer modal (editor mode), the session's working folder in the
 * OS file manager (folder mode), or the workspace in VS Code (vscode mode),
 * plus the overlay modal, the Ctrl+P shortcut, and transient notices.
 *
 * The ButtonGroup registers into `conversation.session.header.utilities`:
 * the left button carries the active mode's icon and triggers its action,
 * the right button opens a dropdown to switch between 编辑器 (editor),
 * 文件夹 (folder), and VSCode. Selecting an entry both persists it as the
 * new default mode and immediately runs that mode's open action. The choice
 * is persisted in localStorage so it survives reloads.
 *
 * The same ButtonGroup is also shown on the new-session screen through the
 * generic `shell.overlay` floating layer (no shell change involved): a
 * plugin-owned entry pins it to the conversation column's top-right while
 * the column is in its hero phase — the no-session hero and the
 * blank-session (new chat) hero, where the session header and its utilities
 * seat are absent or deliberately hidden. The floating entry resolves its
 * session itself: the actions fall back to the live selection
 * (`useSessions` → `state.current`) and show a notice when none exists.
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

/** Which action the header group's main button performs. */
export type HeaderMode = 'editor' | 'folder' | 'vscode'

const MODE_STORAGE_KEY = 'dsh-file-explorer.header-mode'

interface Store {
  open: boolean
  sessionId: string
  notice: string | null
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

/** Ask the host to reveal the session's working folder in the OS file manager. */
async function openSystemFolder(sessionId: string | undefined, cwd?: string): Promise<void> {
  const resolved = sessionId !== undefined && sessionId !== '' ? sessionId : activeSessionId
  if (resolved === undefined) {
    showNotice('没有可用的会话：无法确定文件工作区。请先新建/选择一个会话。')
    return
  }
  try {
    const result = await api.fsReveal({ sessionId: resolved }, cwd)
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
    const result = await api.fsVscode({ sessionId: resolved }, cwd)
    showNotice(`已在 VS Code 打开：${result.cwd}`)
  } catch (error) {
    showNotice(`用 VS Code 打开失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

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
 * Probe the host once per activation for VS Code availability and hide the
 * VSCode option (falling back to the editor) when it is missing — the user
 * explicitly wants the entry hidden rather than shown-but-broken.
 */
function probeVscode(): void {
  void api.fsCapabilities().then((result) => {
    store = { ...store, vscode: result.vscode }
    if (!result.vscode && store.mode === 'vscode') store = { ...store, mode: 'editor' }
    emit()
  }).catch(() => {
    // Probe failed (e.g. older host without the endpoint): assume unavailable.
    store = { ...store, vscode: false }
    if (store.mode === 'vscode') store = { ...store, mode: 'editor' }
    emit()
  })
}

const MODE_ITEMS: MenuEntry[] = [
  { id: 'editor', label: '编辑器', icon: <IconEditOutline16 /> },
  { id: 'folder', label: '文件夹', icon: <IconFolderOpen16 /> },
  { id: 'vscode', label: 'VSCode', icon: <VscodeIcon /> },
]

/** The header ButtonGroup (session header utilities slot; receives sessionId). */
function HeaderGroup(props: { sessionId?: string; useSessions?: FilexUseSessions }): JSX.Element {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const [menuOpen, setMenuOpen] = useState(false)
  const useSessions = props.useSessions ?? (() => undefined)
  // Per-session workspace cwd from the framework session list — a hint for
  // the reveal / vscode actions when the session carries no header cwd.
  const sessionCwd = useSessions(
    (s: FilexSessionListState) => (props.sessionId !== undefined ? s.byId?.[props.sessionId]?.cwd : undefined),
  ) as string | undefined
  const mode = state.mode
  const items = state.vscode ? MODE_ITEMS : MODE_ITEMS.filter(item => item.id !== 'vscode')
  const mainIcon = mode === 'folder' ? <IconFolderOpen16 /> : mode === 'vscode' ? <VscodeIcon /> : <IconEditOutline16 />
  const mainTitle = mode === 'folder' ? '打开系统文件夹' : mode === 'vscode' ? '用 VSCode 打开工作区' : '文件预览 / 编辑（Ctrl+P）'

  const onMainClick = (e: { stopPropagation(): void }): void => {
    e.stopPropagation()
    if (mode === 'folder') void openSystemFolder(props.sessionId, sessionCwd)
    else if (mode === 'vscode') void openInVscode(props.sessionId, sessionCwd)
    else openExplorer(props.sessionId)
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
          if (next === 'folder') void openSystemFolder(props.sessionId, sessionCwd)
          else if (next === 'vscode') void openInVscode(props.sessionId, sessionCwd)
          else openExplorer(props.sessionId)
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

/**
 * Hero / new-session floating utility: the same HeaderGroup, rendered by the
 * plugin itself through the generic `shell.overlay` floating layer (no shell
 * change needed) and pinned to the conversation column's top-right corner —
 * the spot where the session-header utilities sit once a conversation has
 * records. Shown only while the conversation column is in its `hero` phase
 * (no session at all, or a blank session whose header is deliberately
 * hidden); the position is measured from the rendered column root
 * (`[data-phase]`), so sidebar collapse and details-panel toggles are
 * tracked automatically. Clicking behaves exactly like the header icon: in a
 * blank-session hero the actions bind to that session, and with no session
 * at all they surface the no-session notice.
 */
function HeroFilexButton(props: { useSessions?: FilexUseSessions }): JSX.Element | null {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    const update = (): void => {
      const column = document.querySelector<HTMLElement>('[data-phase]')
      if (column === null || column.getAttribute('data-phase') !== 'hero') {
        setPos(null)
        return
      }
      const rect = column.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        setPos(null)
        return
      }
      // Mirror the session header's utilities placement: the header pads
      // 12px top / 28px right and centers the 28px-tall group in its 32px
      // title row (→ 14px top), so the floating icon sits exactly where the
      // in-chat icon does.
      const top = rect.top + 14
      const right = window.innerWidth - rect.right + 28
      setPos(current => current !== null && current.top === top && current.right === right ? current : { top, right })
    }
    const timer = window.setInterval(update, 400)
    window.addEventListener('resize', update)
    update()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', update)
    }
  }, [])

  if (pos === null) return null
  return (
    <div className="filex-hero-fab" style={{ top: pos.top, right: pos.right }}>
      <HeaderGroup useSessions={props.useSessions} />
    </div>
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

    // Header ButtonGroup (editor / folder / vscode) — right-aligned session utility.
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'file-explorer', order: 10, label: '文件预览 / 编辑' },
        HeaderGroup,
      ))

    // Hero / new-session floating utility: the same ButtonGroup, rendered by
    // the plugin itself through the generic `shell.overlay` floating layer
    // (no shell change involved) and pinned to the conversation column's
    // top-right while the column is in its hero phase — the no-session hero
    // and the blank-session (new chat) hero, where the session header (and
    // its utilities seat) is absent or deliberately hidden. The entry
    // positions itself from the rendered column, so it lands exactly where
    // the header icon sits once the conversation has records.
    ctx.slots.inject('shell.overlay', () => {
      const overlay = ctx.slots.register(
        { name: 'shell.overlay', id: 'file-explorer-overlay', order: 100, label: '文件预览' },
        ExplorerOverlay,
      )
      const heroFab = ctx.slots.register(
        { name: 'shell.overlay', id: 'file-explorer-hero-fab', order: 90, label: '文件预览 / 编辑（hero）' },
        HeroFilexButton,
      )
      return () => { overlay(); heroFab() }
    })

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
