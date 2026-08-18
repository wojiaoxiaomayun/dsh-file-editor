/**
 * The code file viewer: a CodeMirror 6 editor with syntax highlighting, a
 * dirty dot, Ctrl/Cmd+S save, and a read-only toggle. Search-result jumps
 * highlight the matched range in the editor. Images / PDFs are handled by
 * the explorer's media viewer instead (markdown / html previews were removed
 * — rendering large documents through the markdown pipeline froze the UI).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  Button,
  IconRightUpOutline16,
  IconWarningOutline16,
  Menu,
  Toast,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { Decoration, type DecorationSet } from '@codemirror/view'
import type { Context } from '../context-types.ts'
import { api, mediaUrl, type SessionScope } from './api.ts'
import { languageForPath } from './lang.ts'
import { editorTheme } from './cm-theme.ts'
import { appendToDraft } from './draft.ts'

/** State effect carrying the matched ranges of a search jump (line flag = whole-line highlight). */
const highlightEffect = StateEffect.define<Array<{ from: number; to: number; line?: boolean }>>()

/** Editor-side safety caps (the host preview is 1 MB; the editor renders less). */
const EDITOR_DOC_CAP = 512 * 1024      // chars handed to CodeMirror at most
const HIGHLIGHT_DOC_CAP = 256 * 1024   // skip syntax highlighting above this (parser cost)
const LONG_LINE_LIMIT = 8 * 1024       // above this, drop line-wrapping (minified files)

/** Length of the longest line in `text` (no allocation). */
function longestLineLength(text: string): number {
  let max = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      const len = i - start
      if (len > max) max = len
      start = i + 1
    }
  }
  const len = text.length - start
  return len > max ? len : max
}

/** Decoration field marking the jump ranges. */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, tr) => {
    let next = decorations.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(highlightEffect)) {
        next = Decoration.set(effect.value.map(r => {
          if (r.line === true) {
            return Decoration.line({ class: 'filex-cm-hit-line' }).range(r.from)
          }
          return Decoration.mark({ class: 'filex-cm-hit' }).range(r.from, r.to)
        }))
      }
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** Compute a 0-based character offset for a 1-based line (1 = first line). */
export function lineOffset(text: string, line: number): number {
  let pos = 0
  const lines = text.split('\n')
  const target = Math.max(0, line - 1)
  for (let i = 0; i < target && i < lines.length; i++) pos += lines[i].length + 1
  return Math.min(pos, text.length)
}

export interface EditorSave {
  ok: boolean
  error?: string
}

export interface TextEditorProps {
  ctx: Context
  scope: SessionScope
  path: string
  content: string
  truncated: boolean
  /** Search jump target: line + per-line ranges (0-based columns). */
  jumpLine?: number
  jumpRanges?: Array<{ start: number; end: number }>
  onSaved?: (ok: boolean, error?: string) => void
}

export function TextEditor(props: TextEditorProps): JSX.Element | null {
  const { ctx, scope, path, content, truncated, jumpLine, jumpRanges, onSaved } = props
  const [draft, setDraft] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [readOnly, setReadOnly] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const savingRef = useRef(false)
  const readOnlyCompartment = useRef(new Compartment())
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fromLine: number; toLine: number; fromCol: number; toCol: number; empty: boolean } | null>(null)
  const [insertError, setInsertError] = useState('')
  const [toastKey, setToastKey] = useState(0)
  const [jumpDebug, setJumpDebug] = useState('')
  const menuAnchorRef = useRef<HTMLSpanElement | null>(null)

  // Large-file guards: the editor gets at most EDITOR_DOC_CAP chars, syntax
  // highlighting is skipped above HIGHLIGHT_DOC_CAP (parser cost), and
  // line-wrapping is dropped for minified files with huge single lines
  // (laying out a 500 KB line is what freezes the tab).
  const doc = content.length > EDITOR_DOC_CAP ? content.slice(0, EDITOR_DOC_CAP) : content
  const maxLineLen = useMemo(() => longestLineLength(doc), [doc])
  const wrapLines = maxLineLen <= LONG_LINE_LIMIT
  const language = doc.length > HIGHLIGHT_DOC_CAP || !wrapLines ? null : languageForPath(path)
  const docTruncated = truncated || content.length > EDITOR_DOC_CAP

  /** Apply a search jump onto a live view: selection, scroll, highlights. */
  const applyJump = (view: EditorView): void => {
    if (jumpLine === undefined) return
    try {
      const text = draft ?? doc
      const from = lineOffset(text, jumpLine)
      // Decoration.set requires ranges sorted by `from` — the whole-line
      // backdrop sits at the line start, so it goes first.
      const ranges: Array<{ from: number; to: number; line?: boolean }> = []
      let lineStart = -1
      try {
        lineStart = view.state.doc.line(jumpLine).from
      } catch {
        // line out of range after content changed
      }
      if (lineStart >= 0) ranges.push({ from: lineStart, to: lineStart, line: true })
      for (const r of jumpRanges ?? []) ranges.push({ from: from + r.start, to: from + r.end })
      view.dispatch({
        effects: [highlightEffect.of(ranges) as StateEffect<unknown>],
        selection: { anchor: from },
        scrollIntoView: true,
      })
      setJumpDebug(`jump L${jumpLine} from=${from} ranges=${ranges.length}`)
    } catch (error) {
      console.warn('[dsh-file-explorer] search jump failed:', error)
      setJumpDebug(`jump ERR: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Create the CodeMirror view once content is loaded.
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers(),
          history(),
          search(),
          EditorState.tabSize.of(2),
          ...(wrapLines ? [EditorView.lineWrapping] : []),
          EditorView.contentAttributes.of({ spellcheck: 'false' }),
          editorTheme,
          ...(language !== null ? [language] : []),
          readOnlyCompartment.current.of(EditorState.readOnly.of(false)),
          highlightField,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setDraft(update.state.doc.toString())
              setDirty(true)
            }
          }),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { save(); return true } },
            ...searchKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
        ],
      }),
      parent: host,
    })
    // Right-click menu: always shown; the selection action is disabled when
    // no text is selected.
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      const sel = view.state.selection.main
      const fromLine = view.state.doc.lineAt(sel.from)
      const toLine = view.state.doc.lineAt(sel.to)
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        fromLine: fromLine.number,
        toLine: toLine.number,
        fromCol: sel.from - fromLine.from + 1,
        toCol: sel.to - toLine.from + 1,
        empty: sel.empty,
      })
    }
    view.dom.addEventListener('contextmenu', onContextMenu)
    viewRef.current = view
    // Apply any pending search jump right after (re)creation — the editor may
    // be brand-new (content just arrived), so do not rely on effect ordering.
    applyJump(view)
    return () => {
      view.dom.removeEventListener('contextmenu', onContextMenu)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, content])

  // Re-apply the jump whenever the target line/ranges or the document text
  // changes after the view already exists.
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    applyJump(view)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpLine, jumpRanges, draft, doc])

  const save = useCallback((): void => {
    const view = viewRef.current
    if (view === null || savingRef.current) return
    savingRef.current = true
    setSaveState('saving')
    void api.fsWrite(scope, path, view.state.doc.toString()).then(() => {
      savingRef.current = false
      setDraft(null)
      setDirty(false)
      setSaveState('saved')
      onSaved?.(true)
    }).catch((error: unknown) => {
      savingRef.current = false
      setSaveState('failed')
      onSaved?.(false, error instanceof Error ? error.message : String(error))
    })
  }, [scope, path, onSaved])

  // Reset per-file state on path change.
  useEffect(() => {
    setDraft(null)
    setDirty(false)
    setSaveState('idle')
    setReadOnly(false)
    setCtxMenu(null)
  }, [path])

  const saveLabel = saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : saveState === 'failed' ? '保存失败' : ''

  const reference = (range?: { fromLine: number; toLine: number; fromCol: number; toCol: number }): string => {
    const base = `@file:${path}`
    if (range === undefined) return base
    const samePoint = range.fromLine === range.toLine && range.fromCol === range.toCol
    if (samePoint) return `${base} lines:${range.fromLine}:${range.fromCol}`
    return `${base} lines:${range.fromLine}:${range.fromCol}-${range.toLine}:${range.toCol}`
  }

  const insertSelection = (): void => {
    if (ctxMenu === null) return
    const result = appendToDraft(ctx, scope.sessionId, reference(ctxMenu))
    setCtxMenu(null)
    if (!result.ok) {
      setInsertError(result.reason ?? '插入失败')
      setToastKey(k => k + 1)
    }
  }

  const insertFile = (): void => {
    if (ctxMenu === null) return
    const result = appendToDraft(ctx, scope.sessionId, reference())
    setCtxMenu(null)
    if (!result.ok) {
      setInsertError(result.reason ?? '插入失败')
      setToastKey(k => k + 1)
    }
  }

  const ctxMenuItems: MenuEntry[] = ctxMenu !== null
    ? [
        {
          id: 'insertSelection',
          label: (
            <span className="filex-ctx-label">
              <span>插入选中文本到聊天框</span>
              <span className="filex-ctx-hint">
                {ctxMenu.empty ? '请先在编辑器中选中文本' : reference(ctxMenu)}
              </span>
            </span>
          ),
          icon: <IconRightUpOutline16 />,
          disabled: ctxMenu.empty,
        },
        {
          id: 'insertFile',
          label: (
            <span className="filex-ctx-label">
              <span>插入整个文件到聊天框</span>
              <span className="filex-ctx-hint">{reference()}</span>
            </span>
          ),
          icon: <IconRightUpOutline16 />,
        },
      ]
    : []

  return (
    <>
      <div className="filex-editor-toolbar">
        {dirty && <span className="filex-dirty" title="有未保存的改动" />}
        {jumpDebug !== '' && <span className="filex-editor-status" title={jumpDebug}>{jumpDebug}</span>}
        {saveLabel !== '' && <span className={`filex-editor-status${saveState === 'failed' ? ' filex-err' : ''}`}>{saveLabel}</span>}
        <span className="filex-toolbar-spacer" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          title={readOnly ? '切换为编辑模式' : '切换为只读模式'}
          onClick={() => {
            const next = !readOnly
            setReadOnly(next)
            viewRef.current?.dispatch({ effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(next)) })
          }}
        >{readOnly ? '编辑' : '只读'}</Button>
        <Button
          type="button"
          size="sm"
          variant="primary"
          title={docTruncated ? '文件被截断，禁止保存以免写坏文件' : '保存（Ctrl+S）'}
          onClick={save}
          disabled={!dirty || docTruncated}
        >保存</Button>
      </div>
      {docTruncated && (
        <div className="filex-trunc-banner">
          文件较大（{truncated ? '超过 1MB' : `超过 ${EDITOR_DOC_CAP / 1024}KB`}），仅预览前 {Math.min(content.length, EDITOR_DOC_CAP / 1024)}KB · 保存已禁用
        </div>
      )}
      <div
        className="filex-editor"
        ref={hostRef}
      />
      {ctxMenu !== null && (
        <Menu
          open
          portal
          compact
          align="start"
          anchor={<span ref={menuAnchorRef} className="filex-ctx-anchor" style={{ left: ctxMenu.x, top: ctxMenu.y }} />}
          getAnchorRect={() => menuAnchorRef.current?.getBoundingClientRect() ?? null}
          items={ctxMenuItems}
          onSelect={(id) => {
            if (id === 'insertSelection') insertSelection()
            else insertFile()
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {insertError !== '' && (
        <Toast
          key={toastKey}
          text={`插入聊天框失败：${insertError}`}
          icon={<IconWarningOutline16 />}
          onDone={() => setInsertError('')}
        />
      )}
    </>
  )
}

/** Re-exported for parity; the editor host uses mediaUrl for images/pdfs. */
export { mediaUrl }
