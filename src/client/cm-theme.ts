/**
 * Lightweight CodeMirror 6 themes for the file editor, derived from the
 * DSH alias tokens so they follow the active dark / light scheme.
 */
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/** EditorView theme using CSS variables (resolves per active scheme). */
const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--dsw-alias-bg-base, #1e1e1e)',
    color: 'var(--dsw-alias-label-primary, #e6e6e6)',
    fontSize: '12.5px',
  },
  '.cm-content': {
    caretColor: 'var(--dsw-alias-label-primary, #e6e6e6)',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    lineHeight: '1.6',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--dsw-alias-label-primary, #e6e6e6)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover, rgba(110, 168, 254, .25))',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, .06))',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, .06))',
    color: 'var(--dsw-alias-label-secondary, #9ca3af)',
    border: 'none',
    borderRight: '1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, .2))',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 6px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, .12))',
    color: 'var(--dsw-alias-label-primary, #e6e6e6)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(251, 191, 36, .35)',
    outline: 'none',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'rgba(251, 191, 36, .55)',
  },
}, { dark: false })

/** Syntax colors via CSS variables too (light/dark resolved by the sheet). */
const syntaxStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword], color: 'var(--filex-tk-kw, #569cd6)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.attributeValue], color: 'var(--filex-tk-str, #ce9178)' },
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: 'var(--filex-tk-com, #6a9955)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--filex-tk-num, #b5cea8)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--filex-tk-fn, #dcdcaa)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--filex-tk-type, #4ec9b0)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--filex-tk-prop, #9cdcfe)' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--dsw-alias-label-primary, #e6e6e6)' },
  { tag: tags.operator, color: 'var(--filex-tk-op, #d4d4d4)' },
  { tag: tags.punctuation, color: 'var(--filex-tk-punc, #d4d4d4)' },
])

/** Full editor extension set (theme + syntax colors). */
export const editorTheme = [baseTheme, syntaxHighlighting(syntaxStyle)]

/** Dark-scheme token overrides injected as a stylesheet (see style.ts). */
export const DARK_TOKENS = {
  '--filex-tk-kw': '#569cd6',
  '--filex-tk-str': '#ce9178',
  '--filex-tk-com': '#6a9955',
  '--filex-tk-num': '#b5cea8',
  '--filex-tk-fn': '#dcdcaa',
  '--filex-tk-type': '#4ec9b0',
  '--filex-tk-prop': '#9cdcfe',
  '--filex-tk-op': '#d4d4d4',
  '--filex-tk-punc': '#d4d4d4',
}

/** Light-scheme token overrides (classic VS Code light colors). */
export const LIGHT_TOKENS = {
  '--filex-tk-kw': '#0000ff',
  '--filex-tk-str': '#a31515',
  '--filex-tk-com': '#008000',
  '--filex-tk-num': '#098658',
  '--filex-tk-fn': '#795e26',
  '--filex-tk-type': '#267f99',
  '--filex-tk-prop': '#001080',
  '--filex-tk-op': '#333333',
  '--filex-tk-punc': '#333333',
}

/** Empty export kept for the EditorView import parity check. */
export type { EditorView }
