/**
 * Client half of dsh-file-explorer: a single header icon that opens the
 * built-in file-explorer modal (preview / edit), plus the overlay modal, the
 * Ctrl+P shortcut, and transient notices.
 *
 * The icon registers into `conversation.session.header.utilities`. Opening
 * the session's working folder in the OS file manager and opening it in an
 * external editor are features of the DSH shell itself in current versions,
 * so this plugin deliberately carries only its own built-in editor and no
 * mode dropdown / no external launchers.
 *
 * The same icon is also shown on the new-session screen through the
 * generic `shell.overlay` floating layer (no shell change involved): a
 * plugin-owned entry pins it to the conversation column's top-right while
 * the column is in its hero phase — the no-session hero and the
 * blank-session (new chat) hero, where the session header and its utilities
 * seat are absent or deliberately hidden. The floating entry resolves its
 * session itself: the action falls back to the live selection
 * (`useSessions` → `state.current`) and shows a notice when none exists.
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
  IconEditOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, FilexSessionListState, FilexUseSessions } from '../context-types.ts'
import { ExplorerModal } from './Explorer.tsx'
import { api } from './api.ts'
import { wrapOpenPath, wrapOpenWorkspacePath, type OpenPathInterceptDeps } from './openpath-intercept.ts'
import { CSS, detectDark, tokenCss } from './style.ts'

/** Services required before mounting. */
export const inject = ['slots', 'sessions', 'workspaces', 'remote', 'remote.session']

interface Store {
  open: boolean
  sessionId: string
  notice: string | null
  /** Absolute path a chat-side path click asked the modal to open (null = none). */
  pendingPath: string | null
  /** Monotonic seq so a repeated click re-opens the file while the modal stays mounted. */
  pendingSeq: number
}

let ctxRef: Context | undefined
let store: Store = { open: false, sessionId: '', notice: null, pendingPath: null, pendingSeq: 0 }
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

/** Close the modal (session binding stays for the next open). */
function closeExplorer(): void {
  store = { ...store, open: false }
  emit()
}

/** The header icon: the built-in file explorer (preview / edit modal). */
function HeaderGroup(props: { sessionId?: string }): JSX.Element {
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
 * Hero / new-session floating utility: the same HeaderGroup, rendered by the
 * plugin itself through the generic `shell.overlay` floating layer (no shell
 * change needed) and pinned to the conversation column's top-right corner —
 * the spot where the session-header utilities sit once a conversation has
 * records. Shown only while the conversation column is in its `hero` phase
 * (no session at all, or a blank session whose header is deliberately
 * hidden); the position is measured from the rendered column root
 * (`[data-phase]`), so sidebar collapse and details-panel toggles are
 * tracked automatically. Clicking behaves exactly like the header icon: in a
 * blank-session hero the action binds to that session, and with no session
 * at all it surfaces the no-session notice.
 */
function HeroFilexButton(): JSX.Element | null {
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
      <HeaderGroup />
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

    // Header icon (built-in editor) — right-aligned session utility.
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'file-explorer', order: 10, label: '文件预览 / 编辑' },
        HeaderGroup,
      ))

    // Hero / new-session floating utility: the same icon, rendered by
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
