/**
 * Client half of dsh-file-explorer: a header-action button that opens the
 * file explorer modal (file tree / name filter / content search / CodeMirror
 * editing / markdown + html previews / image + pdf viewing). Registers into
 * the conversation header actions slot and the shell overlay slot.
 */
import { useSyncExternalStore, type JSX } from 'react'
import type { Context } from '../context-types.ts'
import { ExplorerModal } from './Explorer.tsx'
import { CSS, detectDark, tokenCss } from './style.ts'

/** Services required before mounting. */
export const inject = ['slots', 'sessions']

interface Store {
  open: boolean
  sessionId: string
}

let ctxRef: Context | undefined
let store: Store = { open: false, sessionId: '' }
const listeners = new Set<() => void>()

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

function openExplorer(sessionId: string | undefined): void {
  store = { open: true, sessionId: sessionId ?? '' }
  emit()
}

function closeExplorer(): void {
  store = { ...store, open: false }
  emit()
}

/** The header action button (session header actions slot; receives sessionId). */
function HeaderAction(props: { sessionId?: string }): JSX.Element {
  return (
    <button
      type="button"
      className="filex-action"
      title="文件预览 / 编辑（Ctrl+P）"
      aria-label="文件预览 / 编辑"
      onClick={(e) => { e.stopPropagation(); openExplorer(props.sessionId) }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
    </button>
  )
}

/** The overlay entry: renders the modal while open, otherwise nothing. */
function ExplorerOverlay(): JSX.Element | null {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  if (!state.open) return null
  if (ctxRef === undefined) return null
  return (
    <ExplorerModal
      ctx={ctxRef}
      scope={{ sessionId: state.sessionId }}
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

    // Header action button.
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'file-explorer', order: 5, label: '文件预览' },
        HeaderAction,
      ))

    // Overlay modal.
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'file-explorer-overlay', order: 100, label: '文件预览' },
        ExplorerOverlay,
      ))

    // Global shortcut: Ctrl+P opens / focuses the explorer.
    ctx.effect(() => {
      const onKey = (e: KeyboardEvent): void => {
        if ((e.ctrlKey || e.metaKey) && typeof e.key === 'string' && e.key.toLowerCase() === 'p') {
          e.preventDefault()
          if (!store.open) openExplorer(store.sessionId)
        }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, 'dsh-file-explorer: Ctrl+P shortcut')
  } catch (error) {
    fail('load', error)
  }
}
