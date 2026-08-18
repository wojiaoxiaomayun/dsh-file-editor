/**
 * Stylesheet for the file explorer UI. Injected as one <style data-plugin>
 * tag at client activation; the CSS uses DSH alias tokens so colors follow
 * the active scheme, plus the CodeMirror syntax token variables (dark/light
 * values injected by the theme classifier).
 *
 * Everything the design-system primitives already style (buttons, menus,
 * inputs, modals, toasts, tooltips) is left to them; this sheet only covers
 * the explorer's bespoke layout — the split body, tree rows, search rows,
 * editor chrome — and the small adjustments that compose primitives into
 * native-looking pieces (the header ButtonGroup, the modal surface).
 */
export const CSS = `
/* ── header ButtonGroup (utilities slot) ─────────────────────────────── */
.filex-group{display:inline-flex;align-items:center;position:relative}
.filex-group .filex-group-main{border-radius:8px 0 0 8px;padding:0 9px}
.filex-group .filex-group-trigger{margin-left:-1px;border-radius:0 8px 8px 0;border-left:0;padding:0 7px}

/* ── transient notice strip ──────────────────────────────────────────── */
.filex-notice{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483003;display:flex;align-items:center;gap:10px;max-width:70vw;padding:9px 14px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-state-warn-primary,#f59e0b);background:var(--dsw-alias-bg-layer-2,#1b1b22);border:1px solid rgba(245,158,11,.5);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);pointer-events:auto}
.filex-notice-btn{border:0;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:2px 4px;opacity:.7;flex-shrink:0}
.filex-notice-btn:hover{opacity:1}

/* ── modal surface (headless primitives Modal) ───────────────────────── */
.filex-modal{width:min(1200px,92vw);height:min(780px,88vh);gap:0;padding:0;border-radius:16px}

/* ── explorer frame ──────────────────────────────────────────────────── */
.filex-explorer{display:flex;flex-direction:column;height:100%;min-height:0}
.filex-explorer-header{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));flex-shrink:0}
.filex-title{display:flex;align-items:center;gap:6px;min-width:0;flex:1;font-size:13px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.filex-title-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.filex-header-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
.filex-badge{font-size:10px;padding:2px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.22));color:var(--dsw-alias-label-secondary,#9ca3af)}
.filex-badge-warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.filex-explorer-body{display:flex;flex:1;min-height:0}

/* ── split panes ─────────────────────────────────────────────────────── */
.filex-side{width:320px;flex-shrink:0;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05))}
.filex-main{flex:1;min-width:0;display:flex;flex-direction:column}
.filex-status{display:flex;align-items:center;gap:12px;padding:5px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));font-size:10px;color:var(--dsw-alias-label-secondary,#9ca3af);flex-shrink:0;font-family:ui-monospace,monospace}
.filex-status-hint{margin-left:auto}
.filex-status-dirty{color:var(--dsw-alias-state-warn-primary,#f59e0b)}

/* ── side toolbar / segmented control ────────────────────────────────── */
.filex-toolbar{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px 6px}
.filex-toolbar-spacer{margin-left:auto}
.filex-seg{display:inline-flex;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.35));overflow:hidden;background:var(--dsw-alias-bg-base,#111)}
.filex-seg-btn{border-radius:0;padding:0 12px}
.filex-seg-btn + .filex-seg-btn{border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.35))}
.filex-seg-on{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.25));color:var(--dsw-alias-label-primary,#e6e6e6)}
.filex-input{width:100%;box-sizing:border-box}
.filex-side-pad{padding:0 10px 6px}
.filex-rootpath{font-size:11px;font-family:ui-monospace,monospace;color:var(--dsw-alias-label-secondary,#9ca3af);margin:0 0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filex-searchbox{padding:0 10px 6px;display:flex;flex-direction:column;gap:6px}
.filex-search-opts{display:flex;align-items:center;gap:4px}
.filex-opt{min-width:26px;height:24px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-family:ui-monospace,monospace;border-radius:6px}
.filex-opt-on{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3));color:var(--dsw-alias-label-primary,#e6e6e6)}
.filex-opt-sep{width:1px;height:14px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.35));margin:0 4px}
.filex-filters{display:flex;flex-direction:column;gap:4px}
.filex-filter-row{display:flex;align-items:center;gap:6px}
.filex-filter-row .filex-input{flex:1;width:auto;min-width:0}
.filex-filter-label{width:30px;flex-shrink:0;text-align:right;font-size:11px;color:var(--dsw-alias-label-secondary,#9ca3af)}
.filex-filter-hint{font-size:11px;color:var(--dsw-alias-label-secondary,#9ca3af);opacity:.85;margin:0;line-height:1.5}

/* ── tree / lists ────────────────────────────────────────────────────── */
.filex-scroll{flex:1;min-height:0;overflow-y:auto;padding:6px}
.filex-center{display:flex;align-items:center;justify-content:center;height:100%;text-align:center}
.filex-center p{font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);line-height:1.7;margin:0;white-space:pre-line}
.filex-err{color:var(--dsw-alias-state-error-primary,#f87171)}
.filex-node{display:flex;align-items:center;gap:4px;width:100%;text-align:left;font-size:13px;padding:3px 6px;border:0;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:5px;cursor:pointer;box-sizing:border-box}
.filex-node:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15))}
.filex-node-sel{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3))}
.filex-chev{width:12px;flex-shrink:0;color:var(--dsw-alias-label-secondary,#9ca3af);transition:transform .12s ease}
.filex-node-open .filex-chev{transform:rotate(90deg)}
.filex-vsi{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center}
.filex-vsi svg{display:block;width:100%;height:100%}
.filex-node-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filex-flat-item{display:flex;align-items:center;gap:6px;width:100%;text-align:left;font-size:13px;padding:4px 6px;border:0;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:5px;cursor:pointer;box-sizing:border-box}
.filex-flat-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15))}
.filex-flat-item-sel{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3))}
.filex-flat-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filex-search-group{margin-bottom:10px}
.filex-search-file{display:flex;align-items:center;gap:6px;position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));padding:4px 6px}
.filex-search-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace;font-size:12px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.filex-search-file-count{font-size:11px;color:var(--dsw-alias-label-secondary,#9ca3af)}
.filex-search-row{display:flex;gap:6px;width:100%;text-align:left;padding:2px 6px;border:0;background:transparent;cursor:pointer;border-radius:4px;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,#e6e6e6)}
.filex-search-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15))}
.filex-search-row-sel{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3))}
.filex-search-line{flex-shrink:0;color:var(--dsw-alias-label-secondary,#9ca3af);width:26px;text-align:right;user-select:none}
.filex-search-text{flex:1;min-width:0;white-space:pre-wrap;word-break:break-all;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.filex-search-text mark{background:rgba(251,191,36,.4);color:inherit;border-radius:2px;padding:0}
.filex-search-banner{margin-bottom:8px;padding:4px 8px;font-size:10px;border-radius:6px;border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.12);color:var(--dsw-alias-state-warn-primary,#f59e0b)}

/* ── editor / viewers ────────────────────────────────────────────────── */
.filex-trunc-banner{padding:5px 12px;font-size:10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));background:rgba(245,158,11,.1);color:var(--dsw-alias-state-warn-primary,#f59e0b);flex-shrink:0}
.filex-editor{flex:1;min-height:0;overflow:hidden}
.filex-media-wrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:var(--dsw-alias-bg-base,#111)}
.filex-media-img{max-width:100%;max-height:100%;object-fit:contain}
.filex-pdf{flex:1;min-height:0;width:100%;height:100%;border:0;background:white}
.filex-placeholder{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;opacity:.85}
.filex-placeholder p{font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);margin:0;max-width:70%}
.filex-editor-toolbar{display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));flex-shrink:0;min-height:40px}
.filex-editor-status{font-size:11px;color:var(--dsw-alias-label-secondary,#9ca3af)}
.filex-editor-hidden{display:none}
.filex-dirty{width:8px;height:8px;border-radius:50%;background:#fbbf24;flex-shrink:0}
.filex-cm-hit{background:rgba(251,191,36,.35);border-radius:2px}
.filex-cm-hit-line{background:rgba(251,191,36,.10)}

/* ── context-menu anchor (fixed zero-size probe for primitives Menu) ─── */
.filex-ctx-anchor{position:fixed;width:0;height:0;pointer-events:none}
.filex-ctx-label{display:flex;flex-direction:column;gap:2px}
.filex-ctx-hint{font-size:10px;font-family:ui-monospace,monospace;color:var(--dsw-alias-label-secondary,#9ca3af)}
`

/** Whether the page's current background is dark (CSS-variable luminance probe). */
export function detectDark(): boolean {
  try {
    if (typeof document !== 'undefined' && document.body) {
      const el = document.createElement('div')
      document.body.appendChild(el)
      const bg = window.getComputedStyle(el).getPropertyValue('--dsw-alias-bg-base').trim()
      document.body.removeChild(el)
      const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg)
      if (match) {
        const lum = 0.299 * Number(match[1]) + 0.587 * Number(match[2]) + 0.114 * Number(match[3])
        return lum < 140
      }
    }
  } catch {
    // fall through to default
  }
  return true
}

/** Token variable CSS (dark or light scheme) for the CodeMirror syntax colors. */
export function tokenCss(dark: boolean): string {
  if (dark) {
    return ':root{--filex-tk-kw:#569cd6;--filex-tk-str:#ce9178;--filex-tk-com:#6a9955;--filex-tk-num:#b5cea8;--filex-tk-fn:#dcdcaa;--filex-tk-type:#4ec9b0;--filex-tk-prop:#9cdcfe;--filex-tk-op:#d4d4d4;--filex-tk-punc:#d4d4d4}'
  }
  return ':root{--filex-tk-kw:#0000ff;--filex-tk-str:#a31515;--filex-tk-com:#008000;--filex-tk-num:#098658;--filex-tk-fn:#795e26;--filex-tk-type:#267f99;--filex-tk-prop:#001080;--filex-tk-op:#333333;--filex-tk-punc:#333333}'
}
