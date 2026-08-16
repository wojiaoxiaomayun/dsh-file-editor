// DSH 动态插件「文件预览 / 编辑」 — Client 半部（浏览器 UI）
// 注册两个 Slot：
//   conversation.session.header.actions  → 会话标题栏的打开按钮（拿到 sessionId）
//   shell.overlay                        → 全屏文件预览/编辑弹窗
// 通过 host.call 调用 host.js 暴露的 filex/* RPC。
// 纯 React createElement（无 JSX），样式用 --dsw-alias-* 主题 token（明暗自适应）。
//
// 用法：这段代码是 cordis_define code.client 的函数体（以 return {...} 结尾），
// 与 host.js 组合为一个动态 Cordis 插件 Package。
return {
  inject: ['slots', 'timer'],
  apply(ctx) {
    const h = React.createElement
    const timerSvc = ctx.timer

    // ---------- theme detection (for syntax highlight colors) ----------
    // 优先问主题服务；拿不到时实测页面 CSS 变量亮度，避免浅色主题误配暗色配色
    let isDark = true
    function detectDark() {
      try {
        const themeSvc = ctx.get('theme')
        const snap = themeSvc && themeSvc.getTheme ? themeSvc.getTheme() : null
        if (snap && typeof snap === 'object') {
          const id = String(snap.id || snap.theme || snap.mode || snap.name || '').toLowerCase()
          if (id.indexOf('dark') >= 0) return true
          if (id.indexOf('light') >= 0) return false
        }
      } catch (e) {}
      try {
        if (typeof document !== 'undefined' && document.body) {
          const el = document.createElement('div')
          document.body.appendChild(el)
          const bg = window.getComputedStyle(el).getPropertyValue('--dsw-alias-bg-base').trim()
          document.body.removeChild(el)
          const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg)
          if (m) {
            const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])
            return lum < 140
          }
        }
      } catch (e) {}
      return true
    }
    isDark = detectDark()

    // ---------- shared open state (header action -> overlay) ----------
    const store = { open: false, sessionId: null }
    const listeners = new Set()
    function notify() { listeners.forEach(function (l) { try { l() } catch (e) {} }) }
    function openExplorer(sessionId) { isDark = detectDark(); store.sessionId = sessionId || null; store.open = true; notify() }
    function closeExplorer() { store.open = false; notify() }
    function useStoreTick() {
      const [, setTick] = React.useState(0)
      React.useEffect(function () {
        const l = function () { setTick(function (t) { return t + 1 }) }
        listeners.add(l)
        return function () { listeners.delete(l) }
      }, [])
    }
    function confirmMsg(msg) {
      if (typeof window !== 'undefined' && window.confirm) return window.confirm(msg)
      return true
    }

    // ---------- icons ----------
    const ICON_PATHS = {
      file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
      fileText: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H9H8'],
      folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
      folderOpen: ['M6 14l1.5-4.5A2 2 0 0 1 9.4 8H21a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M3 12V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2'],
      search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
      x: ['M18 6 6 18', 'M6 6l12 12'],
      save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
      refresh: ['M23 4v6h-6', 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'],
      alert: ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
      filter: ['M22 3H2l8 9.46V19l4 2v-8.54z']
    }
    function Icon(props) {
      const paths = ICON_PATHS[props.name] || []
      return h('svg', {
        width: props.size || 14, height: props.size || 14,
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        className: props.className || '', 'aria-hidden': true
      }, paths.map(function (d, i) { return h('path', { key: i, d: d }) }))
    }

    // ---------- small helpers ----------
    function formatSize(n) {
      if (!n) return ''
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1048576).toFixed(1) + ' MB'
    }
    function parseGlobInput(raw) {
      return String(raw || '').split(',').map(function (s) { return s.trim() }).filter(Boolean)
    }

    // ---------- syntax highlight ----------
    const HIGHLIGHT_LIMIT = 100 * 1024
    const HASH_COMMENT_LANGS = new Set(['python', 'shell', 'ruby', 'yaml', 'toml', 'dockerfile', 'r', 'properties'])
    const KW_JS = 'const let var function return if else for while do switch case break continue new class extends super this typeof instanceof in of try catch finally throw async await yield import export from default delete void null undefined true false static get set interface type enum implements readonly public private protected as is keyof namespace declare abstract arguments debugger with NaN Infinity Number String Boolean Array Object Promise Symbol BigInt'
    const KW_C = 'int char float double void return if else for while do switch case break continue struct union enum typedef const static extern register auto sizeof unsigned signed long short volatile goto default class namespace public private protected virtual override new delete template typename using this try catch throw bool string wchar_t'
    const KW_JAVA = 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'
    const KW_PY = 'def class return if elif else for while try except finally with as import from lambda pass break continue yield global nonlocal raise assert del in is not and or None True False async await self'
    const KW_SH = 'if then else elif fi for while do done case esac function return local export echo cd exit in true false'
    const KW_RUBY = 'def class module return if elsif else unless while until for do end begin rescue ensure yield lambda proc require include extend attr_reader attr_writer new self nil true false and or not'
    const KW_GO = 'func package import return if else for range switch case default break continue go defer chan map struct interface type var const select fallthrough goto'
    const KW_RUST = 'fn let mut const static struct enum trait impl pub use mod crate self super return if else match while loop for in break continue move ref as where type dyn async await unsafe extern'
    const KW_PHP = 'function class public private protected static return if else elseif for foreach while do switch case break continue new extends implements namespace use require include echo print true false null array'
    const KW_SQL = 'select from where insert into values update set delete create table index view drop alter add primary key foreign references join inner left right outer on group by order having limit offset distinct union all as and or not null is between like in exists case when then else end'
    const KW_CSS = 'color background border margin padding width height display position top left right bottom font size weight family align justify flex grid absolute relative fixed sticky block inline none auto important'
    const KW_JSON = 'true false null'
    const KW_KOTLIN = 'fun val var class object interface when is in if else for while do return package import override private public protected internal data sealed enum companion init constructor super this null true false suspend'
    const KW_SWIFT = 'func let var class struct enum protocol extension guard if else for while repeat switch case return import init deinit override private public internal static self super nil true false in where'
    const KEYWORDS = {
      javascript: new Set(KW_JS.split(' ')),
      typescript: new Set(KW_JS.split(' ')),
      json: new Set(KW_JSON.split(' ')),
      python: new Set(KW_PY.split(' ')),
      c: new Set(KW_C.split(' ')),
      cpp: new Set(KW_C.split(' ')),
      csharp: new Set(KW_C.split(' ')),
      java: new Set(KW_JAVA.split(' ')),
      kotlin: new Set(KW_KOTLIN.split(' ')),
      swift: new Set(KW_SWIFT.split(' ')),
      shell: new Set(KW_SH.split(' ')),
      ruby: new Set(KW_RUBY.split(' ')),
      go: new Set(KW_GO.split(' ')),
      rust: new Set(KW_RUST.split(' ')),
      php: new Set(KW_PHP.split(' ')),
      sql: new Set(KW_SQL.split(' ')),
      css: new Set(KW_CSS.split(' ')),
      scss: new Set(KW_CSS.split(' '))
    }
    const EXT_LANG = {
      js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
      json: 'json', jsonc: 'json',
      html: 'html', htm: 'html', vue: 'html', svg: 'xml', xml: 'xml',
      css: 'css', scss: 'scss', less: 'css',
      py: 'python', pyw: 'python', md: 'markdown', markdown: 'markdown',
      sh: 'shell', bash: 'shell', zsh: 'shell',
      yml: 'yaml', yaml: 'yaml', java: 'java', c: 'c', h: 'c',
      cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp', cs: 'csharp',
      kt: 'kotlin', kts: 'kotlin', swift: 'swift',
      go: 'go', rs: 'rust', rb: 'ruby', php: 'php', sql: 'sql',
      toml: 'toml', ini: 'ini', conf: 'nginx', properties: 'properties', env: 'properties',
      dockerfile: 'dockerfile', docker: 'dockerfile', r: 'r'
    }
    function detectLanguage(name) {
      const base = (name || '').split('/').pop() || ''
      const lower = base.toLowerCase()
      if (lower === 'dockerfile') return 'dockerfile'
      const ext = lower.split('.').pop() || ''
      return EXT_LANG[ext] || 'text'
    }
    function tokenize(code, lang) {
      if (!code) return []
      const kw = KEYWORDS[lang] || null
      const hashComment = HASH_COMMENT_LANGS.has(lang)
      const re = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[A-Za-z_$][\w$]*|[\s\S]/g
      const out = []
      let m
      while ((m = re.exec(code)) !== null) {
        const t = m[0]
        if (t.length === 0) continue
        const c0 = t[0]
        let cls = ''
        if (c0 === '"' || c0 === "'" || c0 === '`') cls = 'str'
        else if (t[0] === '/' && (t[1] === '/' || t[1] === '*')) cls = 'com'
        else if (c0 === '#' && hashComment) cls = 'com'
        else if (c0 >= '0' && c0 <= '9') cls = 'num'
        else if ((c0 >= 'a' && c0 <= 'z') || (c0 >= 'A' && c0 <= 'Z') || c0 === '_' || c0 === '$') {
          if (kw && kw.has(t)) cls = 'kw'
        }
        out.push({ text: t, cls: cls })
      }
      const merged = []
      for (const s of out) {
        const last = merged[merged.length - 1]
        if (last && last.cls === s.cls) last.text += s.text
        else merged.push({ text: s.text, cls: s.cls })
      }
      return merged
    }
    // 逐行 tokenize：支持在指定行内把匹配区间标记为 hit（搜索结果跳转高亮）
    function tokenizeLines(code, lang, hitLine, hitRanges) {
      const lines = code.split('\n')
      const kw = KEYWORDS[lang] || null
      const hashComment = HASH_COMMENT_LANGS.has(lang)
      const re = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[A-Za-z_$][\w$]*|[\s\S]/g
      const out = []
      for (let li = 0; li < lines.length; li++) {
        const lineText = lines[li]
        const segs = []
        let m
        re.lastIndex = 0
        while ((m = re.exec(lineText)) !== null) {
          const t = m[0]
          if (t.length === 0) { re.lastIndex++; continue }
          const c0 = t[0]
          let cls = ''
          if (c0 === '"' || c0 === "'" || c0 === '`') cls = 'str'
          else if (t[0] === '/' && (t[1] === '/' || t[1] === '*')) cls = 'com'
          else if (c0 === '#' && hashComment) cls = 'com'
          else if (c0 >= '0' && c0 <= '9') cls = 'num'
          else if ((c0 >= 'a' && c0 <= 'z') || (c0 >= 'A' && c0 <= 'Z') || c0 === '_' || c0 === '$') {
            if (kw && kw.has(t)) cls = 'kw'
          }
          let isHit = false
          if (li + 1 === hitLine && hitRanges && hitRanges.length > 0) {
            for (let ri = 0; ri < hitRanges.length; ri++) {
              const r = hitRanges[ri]
              if (m.index < r.end && m.index + t.length > r.start) { isHit = true; break }
            }
          }
          segs.push({ text: t, cls: isHit ? 'hit' : cls })
        }
        const merged = []
        for (const s of segs) {
          const last = merged[merged.length - 1]
          if (last && last.cls === s.cls) last.text += s.text
          else merged.push({ text: s.text, cls: s.cls })
        }
        out.push({ line: li + 1, segs: merged })
      }
      return out
    }

    // ---------- viewer dispatch (mirrors DSH-better-sidebar's builtin viewers) ----------
    const VIEWERS = {
      markdown: ['md', 'markdown'],
      html: ['html', 'htm'],
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'],
      pdf: ['pdf']
    }
    function viewerFor(relPath) {
      const base = (relPath || '').split('/').pop() || ''
      const dot = base.lastIndexOf('.')
      const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
      for (const key in VIEWERS) {
        if (VIEWERS[key].indexOf(ext) >= 0) return key
      }
      return 'code'
    }
    function b64ToBlobUrl(base64, mime) {
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: mime })
      return URL.createObjectURL(blob)
    }

    // ---------- lightweight markdown -> HTML (safe: escape first) ----------
    function escapeHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }
    function inlineMd(s) {
      let out = escapeHtml(s)
      out = out.replace(/`([^`]+)`/g, function (m, code) { return '<code>' + code + '</code>' })
      out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      out = out.replace(/(^|[^*])\*([^*\s][^*\n]*)\*/g, '$1<em>$2</em>')
      out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
        const safe = /^(https?:|mailto:|\/|#|\.\/|\.\.\/)/.test(url) || !/^[a-z]+:/i.test(url)
        return safe ? '<a href="' + url + '" target="_blank" rel="noreferrer">' + text + '</a>' : text
      })
      return out
    }
    function mdToHtml(src) {
      const lines = src.split('\n')
      const out = []
      let i = 0
      let inCode = false
      let codeLang = ''
      let codeBuf = []
      let listType = null
      let inQuote = false
      function flushList() { if (listType) { out.push('</' + listType + '>'); listType = null } }
      function flushQuote() { if (inQuote) { out.push('</blockquote>'); inQuote = false } }
      for (; i < lines.length; i++) {
        const line = lines[i]
        const fence = /^```(\w*)\s*$/.exec(line)
        if (fence) {
          flushList(); flushQuote()
          if (inCode) {
            out.push('<pre><code' + (codeLang ? ' class="lang-' + codeLang + '"' : '') + '>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>')
            codeBuf = []; inCode = false; codeLang = ''
          } else {
            inCode = true; codeLang = fence[1]
          }
          continue
        }
        if (inCode) { codeBuf.push(line); continue }
        const h = /^(#{1,6})\s+(.*)$/.exec(line)
        if (h) {
          flushList(); flushQuote()
          const level = h[1].length
          out.push('<h' + level + '>' + inlineMd(h[2]) + '</h' + level + '>')
          continue
        }
        if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
          flushList(); flushQuote()
          out.push('<hr>')
          continue
        }
        const q = /^>\s?(.*)$/.exec(line)
        if (q) {
          flushList()
          if (!inQuote) { out.push('<blockquote>'); inQuote = true }
          out.push('<p>' + inlineMd(q[1]) + '</p>')
          continue
        }
        const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
        const ol = /^\s*\d+\.\s+(.*)$/.exec(line)
        if (ul || ol) {
          flushQuote()
          const kind = ul ? 'ul' : 'ol'
          if (listType !== kind) { flushList(); out.push('<' + kind + '>'); listType = kind }
          out.push('<li>' + inlineMd((ul || ol)[1]) + '</li>')
          continue
        }
        if (/^\s*$/.test(line)) {
          flushList(); flushQuote()
          out.push('')
          continue
        }
        flushList(); flushQuote()
        const para = []
        while (i < lines.length
          && !/^\s*$/.test(lines[i])
          && !/^```/.test(lines[i])
          && !/^#{1,6}\s/.test(lines[i])
          && !/^\s*[-*+]\s/.test(lines[i])
          && !/^\s*\d+\.\s/.test(lines[i])
          && !/^>\s?/.test(lines[i])) {
          para.push(lines[i]); i++
        }
        i--
        out.push('<p>' + inlineMd(para.join(' ')) + '</p>')
      }
      if (inCode) out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>')
      flushList(); flushQuote()
      return out.join('\n')
    }

    // ---------- header action button ----------
    function HeaderAction(props) {
      // 记住当前会话，供 Ctrl+P 全局快捷键在没有打开面板时使用
      React.useEffect(function () {
        if (props && props.sessionId) store.sessionId = props.sessionId
      }, [props && props.sessionId])
      return h('button', {
        className: 'filex-action',
        title: '文件预览 / 编辑（Ctrl+P）',
        'aria-label': '文件预览 / 编辑',
        onClick: function (e) { e.stopPropagation(); openExplorer(props && props.sessionId) }
      }, h(Icon, { name: 'file', size: 15 }))
    }

    // ---------- editor ----------
    function EditorPane(props) {
      const taRef = React.useRef(null)
      const gutterRef = React.useRef(null)
      const hlRef = React.useRef(null)
      const lineCount = React.useMemo(function () {
        return props.content ? props.content.split('\n').length : 1
      }, [props.content])
      const gutterText = React.useMemo(function () {
        const nums = []
        for (let i = 1; i <= lineCount; i++) nums.push(String(i))
        return nums.join('\n')
      }, [lineCount])
      const hlLines = React.useMemo(function () {
        if (!props.highlight) return null
        if (props.content.length > HIGHLIGHT_LIMIT) return null
        return tokenizeLines(props.content, props.lang || 'text', props.highlightLine || 0, props.highlightRanges || null)
      }, [props.content, props.lang, props.highlight, props.highlightLine, props.highlightRanges])
      function syncScroll() {
        if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop
        if (hlRef.current && taRef.current) {
          hlRef.current.scrollTop = taRef.current.scrollTop
          hlRef.current.scrollLeft = taRef.current.scrollLeft
        }
      }
      function reportCursor() {
        const ta = taRef.current
        if (!ta) return
        const pos = ta.selectionStart
        const upTo = props.content.slice(0, pos)
        let line = 1
        for (let i = 0; i < upTo.length; i++) if (upTo.charCodeAt(i) === 10) line++
        const col = pos - upTo.lastIndexOf('\n')
        props.onCursor && props.onCursor({ line: line, col: col })
      }
      function onKeyDown(e) {
        if (e.key === 'Tab') {
          e.preventDefault()
          const ta = taRef.current
          if (!ta) return
          const start = ta.selectionStart
          const end = ta.selectionEnd
          props.onChange(props.content.slice(0, start) + '  ' + props.content.slice(end))
          timerSvc.timeout(function () {
            ta.selectionStart = start + 2
            ta.selectionEnd = start + 2
            reportCursor()
          }, 0)
          return
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault()
          props.onSave && props.onSave()
        }
      }
      React.useEffect(function () {
        if (!props.scrollLine || !taRef.current) return
        const ta = taRef.current
        const lines = props.content.split('\n')
        let pos = 0
        const target = props.scrollLine - 1
        for (let i = 0; i < target && i < lines.length; i++) pos += lines[i].length + 1
        ta.focus()
        ta.setSelectionRange(pos, pos)
        const lineHeight = parseFloat(window.getComputedStyle(ta).lineHeight) || 18
        ta.scrollTop = Math.max(0, target * lineHeight - ta.clientHeight / 2)
        syncScroll()
      }, [props.scrollLine, props.content])
      return h('div', { className: 'filex-editor' },
        h('div', { className: 'filex-gutter', ref: gutterRef }, gutterText),
        h('div', { className: 'filex-code-wrap' },
          h('pre', { className: 'filex-hl', ref: hlRef, 'aria-hidden': true },
            h('code', null,
              hlLines
                ? hlLines.map(function (row) {
                    const isHit = props.highlightLine && row.line === props.highlightLine
                    return h('span', { key: row.line, className: isHit ? 'filex-hl-line-hit' : undefined },
                      row.segs.map(function (s, i) {
                        if (s.cls) return h('span', { key: i, className: 'tk-' + s.cls }, s.text)
                        return h('span', { key: i }, s.text)
                      }),
                      '\n'
                    )
                  })
                : props.content
            )
          ),
          h('textarea', {
            ref: taRef,
            className: 'filex-textarea',
            value: props.content,
            readOnly: !!props.readOnly,
            spellCheck: false,
            wrap: 'off',
            onChange: function (e) { props.onChange(e.target.value) },
            onScroll: syncScroll,
            onSelect: reportCursor,
            onClick: reportCursor,
            onKeyUp: reportCursor,
            onKeyDown: onKeyDown,
            placeholder: ''
          })
        )
      )
    }

    // ---------- file tree ----------
    function FileTreeNode(props) {
      const node = props.node
      if (node.kind === 'dir') {
        const open = !props.collapsed.has(node.relPath)
        return h('div', { className: 'filex-tree-group' },
          h('button', {
            className: 'filex-node' + (props.selected === node.relPath ? ' filex-node-sel' : ''),
            style: { paddingLeft: 6 + props.depth * 12 },
            onClick: function () { props.onToggle(node.relPath) }
          },
            h('span', { className: 'filex-chev' }, open ? '\u25BE' : '\u25B8'),
            h(Icon, { name: open ? 'folderOpen' : 'folder', size: 13 }),
            h('span', { className: 'filex-node-name', title: node.relPath }, node.name)
          ),
          open ? node.children.map(function (c) {
            return h(FileTreeNode, {
              key: c.relPath, node: c, depth: props.depth + 1,
              collapsed: props.collapsed, selected: props.selected,
              onToggle: props.onToggle, onSelect: props.onSelect
            })
          }) : null
        )
      }
      return h('button', {
        className: 'filex-node' + (props.selected === node.relPath ? ' filex-node-sel' : ''),
        style: { paddingLeft: 6 + props.depth * 12 + 14 },
        title: node.relPath,
        onClick: function () { props.onSelect(node.relPath) }
      },
        h(Icon, { name: 'file', size: 13 }),
        h('span', { className: 'filex-node-name' }, node.name)
      )
    }

    // ---------- main modal ----------
    function ExplorerModal() {
      // data
      const [files, setFiles] = React.useState([])
      const [root, setRoot] = React.useState('')
      const [loading, setLoading] = React.useState(false)
      const [listError, setListError] = React.useState('')
      const [listTruncated, setListTruncated] = React.useState(false)
      // search / filter
      const [searchMode, setSearchMode] = React.useState('name')
      const [nameFilter, setNameFilter] = React.useState('')
      const [searchPattern, setSearchPattern] = React.useState('')
      const [searchOptions, setSearchOptions] = React.useState({ caseSensitive: false, regex: false, wholeWord: false })
      const [searchResults, setSearchResults] = React.useState(null)
      const [searching, setSearching] = React.useState(false)
      const [searchError, setSearchError] = React.useState('')
      const [showFilters, setShowFilters] = React.useState(false)
      const [includeStr, setIncludeStr] = React.useState('')
      const [excludeStr, setExcludeStr] = React.useState('')
      // editor
      const [selected, setSelected] = React.useState(null)
      const [current, setCurrent] = React.useState(null)
      const [kind, setKind] = React.useState(null)
      const [errorMsg, setErrorMsg] = React.useState('')
      const [content, setContent] = React.useState('')
      const [lastSavedContent, setLastSavedContent] = React.useState('')
      const [readOnly, setReadOnly] = React.useState(false)
      const [truncated, setTruncated] = React.useState(false)
      const [fileSize, setFileSize] = React.useState(0)
      const [saving, setSaving] = React.useState(false)
      const [cursor, setCursor] = React.useState({ line: 1, col: 1 })
      const [cursorLine, setCursorLine] = React.useState(0)
      const [collapsed, setCollapsed] = React.useState(new Set())
      // viewer: 'code' | 'markdown' | 'html' | 'image' | 'pdf'
      const [viewer, setViewer] = React.useState('code')
      const [mode, setMode] = React.useState('edit')
      const [mediaSrc, setMediaSrc] = React.useState('')
      // 搜索结果跳转高亮：{ line, ranges: [{start,end}] }
      const [hitRanges, setHitRanges] = React.useState(null)
      const mediaRef = React.useRef(null)
      const searchTimerRef = React.useRef(null)
      const searchSeqRef = React.useRef(0)
      const closeRef = React.useRef(null)
      const nameInputRef = React.useRef(null)

      const dirty = React.useMemo(function () { return content !== lastSavedContent }, [content, lastSavedContent])
      const lang = React.useMemo(function () {
        return detectLanguage(current ? current.name : '')
      }, [current])

      React.useEffect(function () { refreshFiles() }, [])
      React.useEffect(function () { closeRef.current = requestClose })
      // 卸载时释放 blob URL
      React.useEffect(function () {
        return function () {
          if (mediaRef.current) { try { URL.revokeObjectURL(mediaRef.current) } catch (e) {} mediaRef.current = null }
        }
      }, [])
      // Ctrl+P 已在打开状态时触发：聚焦文件名过滤框
      React.useEffect(function () {
        if (store.focusTick && nameInputRef.current) {
          nameInputRef.current.focus()
          nameInputRef.current.select()
        }
      }, [store.focusTick])
      React.useEffect(function () {
        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); closeRef.current && closeRef.current() }
        }
        window.addEventListener('keydown', onKey)
        return function () { window.removeEventListener('keydown', onKey) }
      }, [])

      // ---------- list ----------
      function collectDirPaths(entries) {
        const dirs = new Set()
        for (const f of entries) {
          const parts = f.relPath.split('/')
          let acc = ''
          for (let i = 0; i < parts.length - 1; i++) {
            acc = acc ? acc + '/' + parts[i] : parts[i]
            dirs.add(acc)
          }
        }
        return dirs
      }
      async function refreshFiles() {
        setLoading(true)
        setListError('')
        try {
          const res = await host.call('filex/list', { sessionId: store.sessionId })
          if (!res || !res.ok) {
            setFiles([]); setRoot(''); setListError((res && res.error) || '加载文件列表失败')
            return
          }
          setFiles(res.files || [])
          setRoot(res.root || '')
          setListTruncated(!!res.truncated)
          setCollapsed(new Set(collectDirPaths(res.files || [])))
        } catch (err) {
          setFiles([]); setRoot('')
          setListError(err && err.message ? err.message : String(err))
        } finally {
          setLoading(false)
        }
      }

      const filteredEntries = React.useMemo(function () {
        const q = nameFilter.trim().toLowerCase()
        if (!q) return null
        return files.filter(function (f) {
          return f.relPath.toLowerCase().indexOf(q) >= 0 || f.name.toLowerCase().indexOf(q) >= 0
        })
      }, [files, nameFilter])

      const tree = React.useMemo(function () {
        const rootNodes = []
        const dirs = new Map()
        for (const f of files) {
          const parts = f.relPath.split('/')
          let cur = rootNodes
          let acc = ''
          for (let i = 0; i < parts.length; i++) {
            acc = acc ? acc + '/' + parts[i] : parts[i]
            if (i === parts.length - 1) {
              cur.push({ name: parts[i], relPath: acc, kind: 'file', children: [] })
            } else {
              let node = dirs.get(acc)
              if (!node) {
                node = { name: parts[i], relPath: acc, kind: 'dir', children: [] }
                dirs.set(acc, node)
                cur.push(node)
              }
              cur = node.children
            }
          }
        }
        function sortNodes(nodes) {
          nodes.sort(function (a, b) {
            if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
          })
          for (const n of nodes) if (n.kind === 'dir') sortNodes(n.children)
        }
        sortNodes(rootNodes)
        return rootNodes
      }, [files])

      // ---------- content search ----------
      React.useEffect(function () {
        if (searchTimerRef.current) { searchTimerRef.current(); searchTimerRef.current = null }
        if (searchMode !== 'content') return
        const pattern = searchPattern.trim()
        const seq = ++searchSeqRef.current
        if (!pattern) {
          setSearching(false); setSearchResults(null); setSearchError('')
          return
        }
        setSearching(true)
        setSearchError('')
        searchTimerRef.current = timerSvc.timeout(async function () {
          try {
            const res = await host.call('filex/search', {
              sessionId: store.sessionId,
              pattern: pattern,
              options: searchOptions,
              include: parseGlobInput(includeStr),
              exclude: parseGlobInput(excludeStr)
            })
            if (seq !== searchSeqRef.current) return
            setSearching(false)
            if (!res || !res.ok) { setSearchError((res && res.error) || '搜索失败'); setSearchResults(null) }
            else setSearchResults(res)
          } catch (err) {
            if (seq !== searchSeqRef.current) return
            setSearching(false)
            setSearchError(err && err.message ? err.message : String(err))
            setSearchResults(null)
          }
        }, 300)
        return function () { if (searchTimerRef.current) { searchTimerRef.current(); searchTimerRef.current = null } }
      }, [searchMode, searchPattern, searchOptions, includeStr, excludeStr])

      const groupedResults = React.useMemo(function () {
        const groups = []
        const index = new Map()
        const list = searchResults ? searchResults.results : []
        for (const m of list) {
          let g = index.get(m.file)
          if (!g) { g = { file: m.file, matches: [] }; index.set(m.file, g); groups.push(g) }
          g.matches.push(m)
        }
        return groups
      }, [searchResults])

      function highlightSegments(text, highlights) {
        if (!highlights || highlights.length === 0) return [{ text: text, hit: false }]
        const ranges = highlights.slice().sort(function (a, b) { return a.start - b.start })
        const merged = []
        for (const r of ranges) {
          const last = merged[merged.length - 1]
          if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
          else merged.push({ start: r.start, end: r.end })
        }
        const segs = []
        let pos = 0
        for (const r of merged) {
          if (r.start > pos) segs.push({ text: text.slice(pos, r.start), hit: false })
          if (r.end > r.start) segs.push({ text: text.slice(r.start, r.end), hit: true })
          pos = r.end
        }
        if (pos < text.length) segs.push({ text: text.slice(pos), hit: false })
        return segs
      }

      function toggleOpt(key) {
        setSearchOptions(function (prev) {
          const next = { caseSensitive: prev.caseSensitive, regex: prev.regex, wholeWord: prev.wholeWord }
          next[key] = !next[key]
          return next
        })
      }

      // ---------- open / save ----------
      async function openFile(relPath) {
        if (dirty && current && current.relPath !== relPath) {
          if (!confirmMsg('「' + current.relPath + '」有未保存的改动，放弃并打开其他文件？')) return
        }
        setSelected(relPath)
        setCursorLine(0)
        setHitRanges(null)
        setErrorMsg('')
        setTruncated(false)
        setReadOnly(false)
        setCursor({ line: 1, col: 1 })
        const vw = viewerFor(relPath)
        setViewer(vw)
        if (mediaRef.current) { try { URL.revokeObjectURL(mediaRef.current) } catch (e) {} mediaRef.current = null }
        setMediaSrc('')
        const res = await host.call('filex/read', { sessionId: store.sessionId, relPath: relPath })
        if (!res || !res.ok) {
          setCurrent(null)
          setKind(null)
          setErrorMsg((res && res.error) || '读取失败')
          return
        }
        const matched = files.find(function (f) { return f.relPath === relPath }) || null
        setCurrent(matched)
        setKind(res.kind || 'text')
        setFileSize(res.size || 0)
        setTruncated(!!res.truncated)
        setMode(vw === 'markdown' || vw === 'html' ? 'preview' : 'edit')
        if (res.kind === 'text') {
          const c = res.content || ''
          setContent(c)
          setLastSavedContent(c)
        } else {
          setContent('')
          setLastSavedContent('')
        }
        // image / pdf：通过字节流预览（base64 -> data URL / blob URL）
        if (vw === 'image' || vw === 'pdf') {
          const media = await host.call('filex/media', { sessionId: store.sessionId, relPath: relPath })
          if (media && media.ok) {
            if (vw === 'image') {
              setMediaSrc('data:' + media.mime + ';base64,' + media.base64)
            } else {
              const url = b64ToBlobUrl(media.base64, media.mime)
              mediaRef.current = url
              setMediaSrc(url)
            }
          } else {
            setErrorMsg((media && media.error) || '无法预览该文件')
          }
        }
      }

      async function save() {
        if (!current || kind !== 'text' || truncated || saving || !dirty) return
        setSaving(true)
        try {
          const fresh = await host.call('filex/read', { sessionId: store.sessionId, relPath: current.relPath })
          if (fresh && fresh.ok && fresh.kind === 'text' && fresh.content !== lastSavedContent) {
            if (!confirmMsg('文件已在磁盘上被外部修改，确定覆盖？')) return
          }
          const res = await host.call('filex/write', {
            sessionId: store.sessionId, relPath: current.relPath, content: content
          })
          if (!res || !res.ok) {
            setErrorMsg((res && res.error) || '保存失败')
            return
          }
          setLastSavedContent(content)
          setErrorMsg('')
        } catch (err) {
          setErrorMsg(err && err.message ? err.message : String(err))
        } finally {
          setSaving(false)
        }
      }

      function toggleReadOnly() { setReadOnly(!readOnly) }

      function requestClose() {
        if (dirty && !confirmMsg('有未保存的改动，确定关闭？改动将丢失。')) return
        closeExplorer()
      }

      function toggleDir(relPath) {
        setCollapsed(function (prev) {
          const next = new Set(prev)
          if (next.has(relPath)) next.delete(relPath)
          else next.add(relPath)
          return next
        })
      }

      async function openSearchResult(m) {
        await openFile(m.file)
        setCursorLine(m.line)
        setHitRanges({ line: m.line, ranges: m.highlights })
      }

      // ---------- render ----------
      const sizeText = formatSize(fileSize)
      const cursorText = cursor.line + ':' + cursor.col

      // left panel content
      let sideContent
      if (searchMode === 'name') {
        if (loading) sideContent = h('div', { className: 'filex-center' }, h('p', null, '加载中…'))
        else if (listError) sideContent = h('div', { className: 'filex-center' }, h('p', { className: 'filex-err' }, listError))
        else if (!files.length) sideContent = h('div', { className: 'filex-center' }, h('p', null, '工作区中没有文件'))
        else if (filteredEntries) {
          sideContent = h('div', null,
            filteredEntries.length ? filteredEntries.map(function (f) {
              return h('button', {
                key: f.relPath,
                className: 'filex-flat-item' + (selected === f.relPath ? ' filex-flat-item-sel' : ''),
                title: f.relPath,
                onClick: function () { openFile(f.relPath) }
              },
                h(Icon, { name: 'file', size: 13 }),
                h('span', { className: 'filex-flat-path' }, f.relPath)
              )
            }) : h('div', { className: 'filex-center' }, h('p', null, '没有匹配的文件'))
          )
        } else {
          sideContent = h('div', null, tree.map(function (n) {
            return h(FileTreeNode, {
              key: n.relPath, node: n, depth: 0,
              collapsed: collapsed, selected: selected,
              onToggle: toggleDir, onSelect: openFile
            })
          }))
        }
      } else {
        if (!searchPattern.trim()) sideContent = h('div', { className: 'filex-center' }, h('p', null, '输入关键字搜索文件内容\n支持正则 / 大小写 / 全词匹配'))
        else if (searching) sideContent = h('div', { className: 'filex-center' }, h('p', null, '搜索中…'))
        else if (searchError) sideContent = h('div', { className: 'filex-center' }, h('p', { className: 'filex-err' }, searchError))
        else if (searchResults && !searchResults.results.length) sideContent = h('div', { className: 'filex-center' }, h('p', null, '未找到匹配'))
        else if (searchResults) {
          sideContent = h('div', null,
            searchResults.truncated ? h('div', { className: 'filex-search-banner' }, '结果超过 1000 条，已截断') : null,
            groupedResults.map(function (g) {
              return h('div', { key: g.file, className: 'filex-search-group' },
                h('div', { className: 'filex-search-file' },
                  h(Icon, { name: 'file', size: 12 }),
                  h('span', { className: 'filex-search-file-name', title: g.file }, g.file),
                  h('span', { className: 'filex-search-file-count' }, String(g.matches.length))
                ),
                g.matches.map(function (m, mi) {
                  const segs = highlightSegments(m.text, m.highlights)
                  return h('button', {
                    key: m.file + ':' + m.line + ':' + mi,
                    className: 'filex-search-row' + (selected === m.file && cursorLine === m.line ? ' filex-search-row-sel' : ''),
                    title: m.file + ':' + m.line,
                    onClick: function () { openSearchResult(m) }
                  },
                    h('span', { className: 'filex-search-line' }, String(m.line)),
                    h('span', { className: 'filex-search-text' }, segs.map(function (seg, si) {
                      if (seg.hit) return h('mark', { key: si }, seg.text)
                      return h('span', { key: si }, seg.text)
                    }))
                  )
                })
              )
            })
          )
        }
      }

      // right panel content
      let mainContent
      if (!current) {
        mainContent = h('div', { className: 'filex-placeholder' },
          h(Icon, { name: 'fileText', size: 36 }),
          h('p', null, '从左侧选择文件进行预览 / 编辑')
        )
      } else if (errorMsg) {
        mainContent = h('div', { className: 'filex-placeholder' },
          h(Icon, { name: 'alert', size: 26 }),
          h('p', { className: 'filex-err' }, errorMsg)
        )
      } else if (viewer === 'image') {
        mainContent = mediaSrc
          ? h('div', { className: 'filex-media-wrap' }, h('img', { className: 'filex-media-img', src: mediaSrc, alt: current.relPath }))
          : h('div', { className: 'filex-center' }, h('p', null, '加载图片…'))
      } else if (viewer === 'pdf') {
        mainContent = mediaSrc
          ? h('iframe', { className: 'filex-pdf', src: mediaSrc, title: current.relPath })
          : h('div', { className: 'filex-center' }, h('p', null, '加载 PDF…'))
      } else if (viewer === 'markdown' && mode === 'preview') {
        mainContent = h('div', {
          className: 'filex-md-preview',
          dangerouslySetInnerHTML: { __html: mdToHtml(content) }
        })
      } else if (viewer === 'html' && mode === 'preview') {
        mainContent = h('iframe', {
          className: 'filex-html-preview',
          sandbox: 'allow-scripts allow-popups allow-downloads allow-modals',
          srcDoc: content,
          title: current.relPath
        })
      } else if (kind === 'binary') {
        mainContent = h('div', { className: 'filex-placeholder' },
          h(Icon, { name: 'alert', size: 26 }),
          h('p', null, '暂不支持预览二进制文件')
        )
      } else {
        mainContent = h('div', { className: 'filex-main' },
          truncated ? h('div', { className: 'filex-trunc-banner' }, '文件超过 1MB，仅预览前 1MB · 保存已禁用') : null,
          h(EditorPane, {
            content: content,
            readOnly: readOnly,
            scrollLine: cursorLine,
            lang: lang,
            highlight: kind === 'text',
            highlightLine: hitRanges ? hitRanges.line : 0,
            highlightRanges: hitRanges ? hitRanges.ranges : null,
            onChange: setContent,
            onCursor: setCursor,
            onSave: save
          })
        )
      }

      return h('div', {
        className: 'filex-backdrop' + (isDark ? ' filex-dark' : ' filex-light'),
        onMouseDown: function (e) { if (e.target === e.currentTarget) requestClose() }
      },
        h('div', { className: 'filex-modal', onMouseDown: function (e) { e.stopPropagation() } },
          // header
          h('div', { className: 'filex-header' },
            h('span', { className: 'filex-title' },
              h(Icon, { name: 'fileText', size: 14 }),
              h('span', { className: 'filex-title-text', title: current ? current.relPath : '' },
                current ? current.relPath : '文件预览 / 编辑'),
              dirty ? h('span', { className: 'filex-dirty', title: '有未保存的改动' }) : null
            ),
            h('div', { className: 'filex-header-actions' },
              (viewer === 'markdown' || viewer === 'html') ? h('div', { className: 'filex-seg filex-mode-seg' },
                h('button', {
                  className: 'filex-seg-btn' + (mode === 'preview' ? ' filex-seg-on' : ''),
                  onClick: function () { setMode('preview') },
                  title: '预览渲染结果'
                }, '预览'),
                h('button', {
                  className: 'filex-seg-btn' + (mode === 'edit' ? ' filex-seg-on' : ''),
                  onClick: function () { setMode('edit') },
                  title: '编辑源码'
                }, '编辑')
              ) : null,
              readOnly && current ? h('span', { className: 'filex-badge' }, '只读') : null,
              truncated ? h('span', { className: 'filex-badge filex-badge-warn' }, '已截断') : null,
              h('button', {
                className: 'filex-btn',
                disabled: !current || kind !== 'text',
                onClick: toggleReadOnly,
                title: readOnly ? '切换为编辑模式' : '切换为只读模式'
              }, readOnly ? '编辑' : '只读'),
              h('button', {
                className: 'filex-btn',
                disabled: !dirty || saving || truncated,
                onClick: save,
                title: '保存（Ctrl+S）'
              }, saving ? '保存中…' : '保存'),
              h('button', {
                className: 'filex-btn filex-btn-icon',
                title: '关闭（Esc）',
                'aria-label': '关闭',
                onClick: requestClose
              }, h(Icon, { name: 'x', size: 14 }))
            )
          ),
          // body
          h('div', { className: 'filex-body' },
            // left
            h('div', { className: 'filex-side' },
              h('div', { className: 'filex-toolbar' },
                h('div', { className: 'filex-seg' },
                  h('button', {
                    className: 'filex-seg-btn' + (searchMode === 'name' ? ' filex-seg-on' : ''),
                    onClick: function () { setSearchMode('name') },
                    title: '按文件名过滤'
                  }, '文件名'),
                  h('button', {
                    className: 'filex-seg-btn' + (searchMode === 'content' ? ' filex-seg-on' : ''),
                    onClick: function () { setSearchMode('content') },
                    title: '跨工作区搜索文件内容'
                  }, '内容')
                ),
                searchMode === 'name' ? h('button', {
                  className: 'filex-btn filex-btn-icon',
                  disabled: loading,
                  onClick: refreshFiles,
                  title: '刷新文件列表'
                }, h(Icon, { name: 'refresh', size: 13, className: loading ? 'filex-spin' : '' })) : null
              ),
              root ? h('div', { className: 'filex-side-pad' }, h('p', { className: 'filex-rootpath', title: root }, root)) : null,
              searchMode === 'name'
                ? h('div', { className: 'filex-side-pad' },
                    h('input', {
                      ref: nameInputRef,
                      className: 'filex-input',
                      autoFocus: true,
                      value: nameFilter,
                      onChange: function (e) { setNameFilter(e.target.value) },
                      placeholder: '按文件名过滤…（Ctrl+P 快速打开）'
                    })
                  )
                : h('div', { className: 'filex-searchbox' },
                    h('input', {
                      className: 'filex-input',
                      value: searchPattern,
                      onChange: function (e) { setSearchPattern(e.target.value) },
                      placeholder: '搜索文件内容…'
                    }),
                    h('div', { className: 'filex-search-opts' },
                      h('button', { className: 'filex-opt' + (searchOptions.caseSensitive ? ' filex-opt-on' : ''), title: '区分大小写', onClick: function () { toggleOpt('caseSensitive') } }, 'Aa'),
                      h('button', { className: 'filex-opt' + (searchOptions.regex ? ' filex-opt-on' : ''), title: '正则匹配', onClick: function () { toggleOpt('regex') } }, '.*'),
                      h('button', { className: 'filex-opt' + (searchOptions.wholeWord ? ' filex-opt-on' : ''), title: '全词匹配', onClick: function () { toggleOpt('wholeWord') } }, 'ab'),
                      h('span', { className: 'filex-opt-sep' }),
                      h('button', { className: 'filex-opt' + (showFilters ? ' filex-opt-on' : ''), title: '包含 / 排除', onClick: function () { setShowFilters(!showFilters) } }, h(Icon, { name: 'filter', size: 12 }))
                    ),
                    showFilters ? h('div', { className: 'filex-filters' },
                      h('div', { className: 'filex-filter-row' },
                        h('span', { className: 'filex-filter-label' }, '包含'),
                        h('input', { className: 'filex-input', value: includeStr, onChange: function (e) { setIncludeStr(e.target.value) }, placeholder: '*.ts, src/**' })
                      ),
                      h('div', { className: 'filex-filter-row' },
                        h('span', { className: 'filex-filter-label' }, '排除'),
                        h('input', { className: 'filex-input', value: excludeStr, onChange: function (e) { setExcludeStr(e.target.value) }, placeholder: 'dist, **/*.min.js' })
                      ),
                      h('p', { className: 'filex-filter-hint' }, '逗号分隔多个模式；裸目录名自动匹配任意层级（dist ≡ **/dist/**）')
                    ) : null
                  ),
              listTruncated && searchMode === 'name' ? h('div', { className: 'filex-side-pad' }, h('p', { className: 'filex-filter-hint' }, '文件过多，列表已截断（最多 30000 个文件）')) : null,
              h('div', { className: 'filex-scroll' }, sideContent)
            ),
            // right
            mainContent
          ),
          // status
          h('div', { className: 'filex-status' },
            h('span', { className: 'filex-status-item' }, cursorText),
            h('span', { className: 'filex-status-item' }, sizeText),
            dirty ? h('span', { className: 'filex-status-item filex-status-dirty' }, '未保存') : null,
            h('span', { className: 'filex-status-hint' }, 'Ctrl+S 保存 · Tab 缩进 · Esc 关闭')
          )
        )
      )
    }

    function ExplorerOverlay() {
      useStoreTick()
      if (!store.open) return null
      return h(ExplorerModal, { key: String(store.sessionId || '') })
    }

    // ---------- global shortcut: Ctrl+P opens / focuses the explorer ----------
    ctx.effect(function () {
      function onKey(e) {
        if ((e.ctrlKey || e.metaKey) && typeof e.key === 'string' && e.key.toLowerCase() === 'p') {
          e.preventDefault()
          if (store.open) {
            store.focusTick = (store.focusTick || 0) + 1
            notify()
          } else {
            openExplorer(store.sessionId)
          }
        }
      }
      window.addEventListener('keydown', onKey)
      return function () { window.removeEventListener('keydown', onKey) }
    })

    // ---------- styles ----------
    styles.insert('.filex-action{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer;padding:0;transition:background .12s ease}.filex-action:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.18));color:var(--dsw-alias-label-primary,#e6e6e6)}.filex-backdrop{position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;pointer-events:auto}.filex-modal{display:flex;flex-direction:column;width:min(1120px,95vw);height:min(760px,92vh);background:var(--dsw-alias-bg-base,#1e1e1e);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:12px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.45)}.filex-header{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));flex-shrink:0}.filex-title{display:flex;align-items:center;gap:6px;min-width:0;flex:1;font-size:12px;color:var(--dsw-alias-label-primary,#e6e6e6)}.filex-title-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.filex-dirty{width:8px;height:8px;border-radius:50%;background:#fbbf24;flex-shrink:0}.filex-header-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}.filex-badge{font-size:10px;padding:2px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.22));color:var(--dsw-alias-label-secondary,#9ca3af)}.filex-badge-warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}.filex-btn{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer;white-space:nowrap}.filex-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#6ea8fe)}.filex-btn:disabled{opacity:.45;cursor:not-allowed}.filex-btn-icon{padding:4px;width:26px;height:26px;justify-content:center}.filex-body{display:flex;flex:1;min-height:0}.filex-side{width:320px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05))}.filex-main{flex:1;min-width:0;display:flex;flex-direction:column}.filex-toolbar{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px 6px}.filex-seg{display:flex;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.35));overflow:hidden;background:var(--dsw-alias-bg-base,#111)}.filex-seg-btn{font-size:11px;font-weight:500;padding:4px 12px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer}.filex-seg-btn:hover{color:var(--dsw-alias-label-primary,#e6e6e6)}.filex-seg-on{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.25));color:var(--dsw-alias-label-primary,#e6e6e6)}.filex-input{width:100%;box-sizing:border-box;font-size:12px;padding:5px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.35));background:var(--dsw-alias-bg-base,#111);color:var(--dsw-alias-label-primary,#e6e6e6);outline:none}.filex-input:focus{border-color:var(--dsw-alias-brand-primary,#6ea8fe)}.filex-side-pad{padding:0 10px 6px}.filex-rootpath{font-size:10px;font-family:ui-monospace,monospace;color:var(--dsw-alias-label-secondary,#9ca3af);margin:0 0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.filex-searchbox{padding:0 10px 6px;display:flex;flex-direction:column;gap:6px}.filex-search-opts{display:flex;align-items:center;gap:4px}.filex-opt{min-width:22px;height:20px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-family:ui-monospace,monospace;border-radius:5px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9ca3af);cursor:pointer}.filex-opt:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15))}.filex-opt-on{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3));color:var(--dsw-alias-label-primary,#e6e6e6)}.filex-opt-sep{width:1px;height:14px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.35));margin:0 4px}.filex-filters{display:flex;flex-direction:column;gap:4px}.filex-filter-row{display:flex;align-items:center;gap:6px}.filex-filter-label{width:30px;flex-shrink:0;text-align:right;font-size:10px;color:var(--dsw-alias-label-secondary,#9ca3af)}.filex-filter-hint{font-size:10px;color:var(--dsw-alias-label-secondary,#9ca3af);opacity:.85;margin:0;line-height:1.5}.filex-scroll{flex:1;min-height:0;overflow-y:auto;padding:6px}.filex-center{display:flex;align-items:center;justify-content:center;height:100%;text-align:center}.filex-center p{font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);line-height:1.7;margin:0;white-space:pre-line}.filex-err{color:var(--dsw-alias-state-error-primary,#f87171)}.filex-node{display:flex;align-items:center;gap:4px;width:100%;text-align:left;font-size:12px;padding:3px 6px;border:0;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:5px;cursor:pointer;box-sizing:border-box}.filex-node:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15))}.filex-node-sel{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3))}.filex-chev{width:12px;flex-shrink:0;font-size:10px;color:var(--dsw-alias-label-secondary,#9ca3af)}.filex-node-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.filex-flat-item{display:flex;align-items:center;gap:6px;width:100%;text-align:left;font-size:12px;padding:4px 6px;border:0;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:5px;cursor:pointer;box-sizing:border-box}.filex-flat-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15))}.filex-flat-item-sel{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3))}.filex-flat-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.filex-search-group{margin-bottom:10px}.filex-search-file{display:flex;align-items:center;gap:6px;position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));padding:4px 6px}.filex-search-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace;font-size:11px;color:var(--dsw-alias-label-primary,#e6e6e6)}.filex-search-file-count{font-size:10px;color:var(--dsw-alias-label-secondary,#9ca3af)}.filex-search-row{display:flex;gap:6px;width:100%;text-align:left;padding:2px 6px;border:0;background:transparent;cursor:pointer;border-radius:4px;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-primary,#e6e6e6)}.filex-search-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15))}.filex-search-row-sel{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.3))}.filex-search-line{flex-shrink:0;color:var(--dsw-alias-label-secondary,#9ca3af);width:26px;text-align:right;user-select:none}.filex-search-text{flex:1;min-width:0;white-space:pre-wrap;word-break:break-all;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.filex-search-text mark{background:rgba(251,191,36,.4);color:inherit;border-radius:2px;padding:0}.filex-search-banner{margin-bottom:8px;padding:4px 8px;font-size:10px;border-radius:6px;border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.12);color:var(--dsw-alias-state-warn-primary,#f59e0b)}.filex-trunc-banner{padding:5px 12px;font-size:10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));background:rgba(245,158,11,.1);color:var(--dsw-alias-state-warn-primary,#f59e0b);flex-shrink:0}.filex-editor{flex:1;min-height:0;display:flex;overflow:hidden;background:var(--dsw-alias-bg-base,#1e1e1e)}.filex-gutter{flex-shrink:0;width:48px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.06));color:var(--dsw-alias-label-secondary,#9ca3af);text-align:right;padding:8px 8px 8px 0;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;line-height:1.6;user-select:none;white-space:pre}.filex-textarea{position:absolute;inset:0;width:100%;height:100%;resize:none;border:0;outline:none;background:transparent;color:transparent;caret-color:var(--dsw-alias-label-primary,#e6e6e6);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;line-height:1.6;padding:8px 12px;box-sizing:border-box;tab-size:2;white-space:pre;overflow:auto}.filex-code-wrap{position:relative;flex:1;min-width:0;overflow:hidden;background:var(--dsw-alias-bg-base,#1e1e1e)}.filex-hl{position:absolute;top:0;left:0;height:100%;min-width:100%;width:max-content;margin:0;overflow:hidden;padding:8px 12px;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;line-height:1.6;white-space:pre;tab-size:2;pointer-events:none;color:var(--dsw-alias-label-primary,#e6e6e6)}.filex-hl code{font-family:inherit;font-size:inherit;line-height:inherit}.filex-dark .tk-kw{color:#569cd6}.filex-dark .tk-str{color:#ce9178}.filex-dark .tk-com{color:#6a9955;font-style:italic}.filex-dark .tk-num{color:#b5cea8}.filex-light .tk-kw{color:#0000ff}.filex-light .tk-str{color:#a31515}.filex-light .tk-com{color:#008000;font-style:italic}.filex-light .tk-num{color:#098658}.filex-placeholder{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;opacity:.85}.filex-placeholder p{font-size:12px;color:var(--dsw-alias-label-secondary,#9ca3af);margin:0;max-width:70%}.filex-status{display:flex;align-items:center;gap:12px;padding:5px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));font-size:10px;color:var(--dsw-alias-label-secondary,#9ca3af);flex-shrink:0;font-family:ui-monospace,monospace}.filex-status-hint{margin-left:auto}.filex-status-dirty{color:var(--dsw-alias-state-warn-primary,#f59e0b)}.filex-spin{animation:filex-spin 1s linear infinite}@keyframes filex-spin{to{transform:rotate(360deg)}}.filex-mode-seg{margin-right:4px}.filex-md-preview{flex:1;min-height:0;overflow:auto;padding:18px 24px;font-size:13.5px;line-height:1.75;color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-base,#111)}.filex-md-preview h1,.filex-md-preview h2,.filex-md-preview h3,.filex-md-preview h4,.filex-md-preview h5,.filex-md-preview h6{margin:1.2em 0 .5em;line-height:1.35;font-weight:600}.filex-md-preview h1{font-size:1.6em;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));padding-bottom:.3em}.filex-md-preview h2{font-size:1.35em;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));padding-bottom:.25em}.filex-md-preview h3{font-size:1.15em}.filex-md-preview p{margin:.5em 0}.filex-md-preview code{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.18));border-radius:4px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}.filex-md-preview pre{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.1));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));border-radius:8px;padding:10px 14px;overflow:auto;margin:.8em 0}.filex-md-preview pre code{background:transparent;padding:0}.filex-md-preview blockquote{border-left:3px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));margin:.8em 0;padding:.2em 0 .2em 14px;color:var(--dsw-alias-label-secondary,#9ca3af)}.filex-md-preview a{color:var(--dsw-alias-brand-primary,#6ea8fe);text-decoration:none}.filex-md-preview a:hover{text-decoration:underline}.filex-md-preview ul,.filex-md-preview ol{margin:.5em 0;padding-left:1.6em}.filex-md-preview li{margin:.2em 0}.filex-md-preview hr{border:0;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));margin:1.2em 0}.filex-md-preview img{max-width:100%}.filex-media-wrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:var(--dsw-alias-bg-base,#111)}.filex-media-img{max-width:100%;max-height:100%;object-fit:contain}.filex-pdf{flex:1;min-height:0;width:100%;height:100%;border:0;background:white}.filex-html-preview{flex:1;min-height:0;width:100%;height:100%;border:0;background:white}.tk-hit{background:rgba(251,191,36,.35);border-radius:2px}.filex-hl-line-hit{background:rgba(251,191,36,.10)}')

    // ---------- registrations ----------
    ctx.slots.inject('conversation.session.header.actions', function () {
      return ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'file-explorer', order: 5, label: '文件预览' },
        HeaderAction
      )
    })
    ctx.slots.inject('shell.overlay', function () {
      return ctx.slots.register(
        { name: 'shell.overlay', id: 'file-explorer-overlay', order: 100, label: '文件预览' },
        ExplorerOverlay
      )
    })
  }
}
