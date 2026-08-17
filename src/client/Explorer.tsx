/**
 * The file explorer modal: left panel (file tree / name filter / content
 * search) and right panel (viewer: code editor, image / pdf). Built on the
 * /filex API.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '../context-types.ts'
import { api, mediaUrl, type FsEntry, type SearchMatch, type SessionScope } from './api.ts'
import { TextEditor } from './TextEditor.tsx'
import { appendToDraft } from './draft.ts'

/** Viewer kinds dispatched by extension (markdown / html open in the code editor). */
const VIEWERS: Record<string, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'],
  pdf: ['pdf'],
}

function viewerFor(relPath: string): string {
  const base = relPath.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
  for (const key of Object.keys(VIEWERS)) {
    if (VIEWERS[key].includes(ext)) return key
  }
  return 'code'
}

function formatSize(n: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

function parseGlobInput(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

interface TreeNode {
  name: string
  relPath: string
  kind: 'dir' | 'file'
  children: TreeNode[]
}

function collectDirPaths(entries: FsEntry[]): Set<string> {
  const dirs = new Set<string>()
  for (const f of entries) {
    const parts = f.relPath.split('/')
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      dirs.add(acc)
    }
  }
  return dirs
}

function buildTree(entries: FsEntry[]): TreeNode[] {
  const root: TreeNode[] = []
  const dirs = new Map<string, TreeNode>()
  for (const f of entries) {
    const parts = f.relPath.split('/')
    let cur = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
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
  const sortNodes = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    for (const node of nodes) if (node.kind === 'dir') sortNodes(node.children)
  }
  sortNodes(root)
  return root
}

function highlightSegments(text: string, highlights: Array<{ start: number; end: number }>): Array<{ text: string; hit: boolean }> {
  if (!highlights || highlights.length === 0) return [{ text, hit: false }]
  const ranges = highlights.slice().sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else merged.push({ start: r.start, end: r.end })
  }
  const segs: Array<{ text: string; hit: boolean }> = []
  let pos = 0
  for (const r of merged) {
    if (r.start > pos) segs.push({ text: text.slice(pos, r.start), hit: false })
    if (r.end > r.start) segs.push({ text: text.slice(r.start, r.end), hit: true })
    pos = r.end
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), hit: false })
  return segs
}

interface FileTreeNodeProps {
  node: TreeNode
  depth: number
  collapsed: Set<string>
  selected: string | null
  onToggle: (relPath: string) => void
  onSelect: (relPath: string) => void
  onContextMenu: (relPath: string, x: number, y: number) => void
}

function FileTreeNode(props: FileTreeNodeProps): JSX.Element {
  const { node, depth, collapsed, selected, onToggle, onSelect, onContextMenu } = props
  if (node.kind === 'dir') {
    const open = !collapsed.has(node.relPath)
    return (
      <div className="filex-tree-group">
        <button
          type="button"
          className={`filex-node${selected === node.relPath ? ' filex-node-sel' : ''}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => onToggle(node.relPath)}
          onContextMenu={(e) => { e.preventDefault(); onContextMenu(node.relPath, e.clientX, e.clientY) }}
        >
          <span className="filex-chev">{open ? '▾' : '▸'}</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {open
              ? <><path d="M6 14l1.5-4.5A2 2 0 0 1 9.4 8H21a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M3 12V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2" /></>
              : <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />}
          </svg>
          <span className="filex-node-name" title={node.relPath}>{node.name}</span>
        </button>
        {open && node.children.map(child => (
          <FileTreeNode
            key={child.relPath}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            selected={selected}
            onToggle={onToggle}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={`filex-node${selected === node.relPath ? ' filex-node-sel' : ''}`}
      style={{ paddingLeft: 6 + depth * 12 + 14 }}
      title={node.relPath}
      onClick={() => onSelect(node.relPath)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(node.relPath, e.clientX, e.clientY) }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <span className="filex-node-name">{node.name}</span>
    </button>
  )
}

interface ExplorerModalProps {
  ctx: Context
  scope: SessionScope
  onClose: () => void
}

export function ExplorerModal(props: ExplorerModalProps): JSX.Element | null {
  const { ctx, scope, onClose } = props
  const [files, setFiles] = useState<FsEntry[]>([])
  const [root, setRoot] = useState('')
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [listTruncated, setListTruncated] = useState(false)
  const [searchMode, setSearchMode] = useState<'name' | 'content'>('name')
  const [nameFilter, setNameFilter] = useState('')
  const [searchPattern, setSearchPattern] = useState('')
  const [searchOptions, setSearchOptions] = useState({ caseSensitive: false, regex: false, wholeWord: false })
  const [searchResults, setSearchResults] = useState<{ results: SearchMatch[]; truncated: boolean } | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [includeStr, setIncludeStr] = useState('')
  const [excludeStr, setExcludeStr] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [viewer, setViewer] = useState('code')
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [openTitle, setOpenTitle] = useState('')
  const [openContent, setOpenContent] = useState('')
  const [openTruncated, setOpenTruncated] = useState(false)
  const [jumpLine, setJumpLine] = useState<number | undefined>(undefined)
  const [jumpRanges, setJumpRanges] = useState<Array<{ start: number; end: number }> | undefined>(undefined)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [savedFlash, setSavedFlash] = useState('')
  const [sideMenu, setSideMenu] = useState<{ x: number; y: number; relPath: string; line?: number } | null>(null)
  const [sideToast, setSideToast] = useState('')
  const sideMenuRef = useRef<HTMLDivElement | null>(null)
  const searchSeq = useRef(0)

  // Close the explorer context menu on outside clicks / blur (capture phase).
  useEffect(() => {
    if (sideMenu === null) return
    const close = (e: MouseEvent): void => {
      const target = e.target as Node | null
      if (target !== null && sideMenuRef.current !== null && sideMenuRef.current.contains(target)) return
      setSideMenu(null)
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('blur', () => setSideMenu(null))
    return () => window.removeEventListener('mousedown', close, true)
  }, [sideMenu])

  // Auto-dismiss the toast.
  useEffect(() => {
    if (sideToast === '') return
    const timer = window.setTimeout(() => setSideToast(''), 4000)
    return () => window.clearTimeout(timer)
  }, [sideToast])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setListError('')
    try {
      const result = await api.fsList(scope)
      setFiles(result.files)
      setRoot(result.root)
      setListTruncated(result.truncated)
      setCollapsed(new Set(collectDirPaths(result.files)))
    } catch (error) {
      setFiles([])
      setRoot('')
      setListError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { void refresh() }, [refresh])

  // Esc closes the explorer (leave it to the CodeMirror search panel when its
  // input is focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      if (target !== null && target.closest('.cm-panel')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Debounced content search.
  useEffect(() => {
    if (searchMode !== 'content') return
    const pattern = searchPattern.trim()
    const seq = ++searchSeq.current
    if (pattern === '') {
      setSearching(false)
      setSearchResults(null)
      setSearchError('')
      return
    }
    setSearching(true)
    setSearchError('')
    const timer = window.setTimeout(() => {
      void api.fsSearch(scope, pattern, searchOptions, parseGlobInput(includeStr), parseGlobInput(excludeStr))
        .then(result => {
          if (seq !== searchSeq.current) return
          setSearching(false)
          setSearchResults(result)
        })
        .catch((error: unknown) => {
          if (seq !== searchSeq.current) return
          setSearching(false)
          setSearchError(error instanceof Error ? error.message : String(error))
          setSearchResults(null)
        })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchMode, searchPattern, searchOptions, includeStr, excludeStr, scope])

  const openFile = useCallback(async (relPath: string, jump?: SearchMatch): Promise<void> => {
    setSelected(relPath)
    setOpenPath(relPath)
    setOpenTitle(relPath.split('/').pop() ?? relPath)
    const vw = viewerFor(relPath)
    setViewer(vw)
    setJumpLine(undefined)
    setJumpRanges(undefined)
    if (jump) {
      setJumpLine(jump.line)
      setJumpRanges(jump.highlights)
    }
    setSavedFlash('')
    if (vw === 'image' || vw === 'pdf') {
      setOpenContent('')
      setOpenTruncated(false)
      return
    }
    try {
      const result = await api.fsRead(scope, relPath)
      if (result.kind === 'text') {
        setOpenContent(result.content)
        setOpenTruncated(result.truncated)
      } else {
        setOpenContent('')
        setOpenTruncated(false)
      }
    } catch (error) {
      setOpenContent('')
      setOpenTruncated(false)
      setSavedFlash(error instanceof Error ? error.message : String(error))
    }
  }, [scope])

  const filteredEntries = useMemo(() => {
    const q = nameFilter.trim().toLowerCase()
    if (!q) return null
    return files.filter(f =>
      f.relPath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
  }, [files, nameFilter])

  const tree = useMemo(() => buildTree(files), [files])

  const groupedResults = useMemo(() => {
    const groups: Array<{ file: string; matches: SearchMatch[] }> = []
    const index = new Map<string, { file: string; matches: SearchMatch[] }>()
    for (const m of searchResults?.results ?? []) {
      let group = index.get(m.file)
      if (!group) {
        group = { file: m.file, matches: [] }
        index.set(m.file, group)
        groups.push(group)
      }
      group.matches.push(m)
    }
    return groups
  }, [searchResults])

  const toggleDir = (relPath: string): void => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }

  const toggleOpt = (key: 'caseSensitive' | 'regex' | 'wholeWord'): void => {
    setSearchOptions(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const onSaved = (ok: boolean, error?: string): void => {
    setSavedFlash(ok ? '已保存' : `保存失败：${error ?? ''}`)
  }

  const insertSideRef = (relPath: string, line?: number): void => {
    const ref = line !== undefined ? `@file:${relPath} lines:${line}` : `@file:${relPath}`
    const result = appendToDraft(ctx, scope.sessionId, ref)
    setSideMenu(null)
    if (!result.ok) setSideToast(result.reason ?? '插入失败')
  }

  let sideContent: JSX.Element
  if (searchMode === 'name') {
    if (loading) {
      sideContent = <div className="filex-center"><p>加载中…</p></div>
    } else if (listError) {
      sideContent = <div className="filex-center"><p className="filex-err">{listError}</p></div>
    } else if (files.length === 0) {
      sideContent = <div className="filex-center"><p>工作区中没有文件</p></div>
    } else if (filteredEntries !== null) {
      sideContent = (
        <div>
          {filteredEntries.length > 0
            ? filteredEntries.map(f => (
              <button
                key={f.relPath}
                type="button"
                className={`filex-flat-item${selected === f.relPath ? ' filex-flat-item-sel' : ''}`}
                title={f.relPath}
                onClick={() => void openFile(f.relPath)}
                onContextMenu={(e) => { e.preventDefault(); setSideMenu({ x: e.clientX, y: e.clientY, relPath: f.relPath }) }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                <span className="filex-flat-path">{f.relPath}</span>
              </button>
            ))
            : <div className="filex-center"><p>没有匹配的文件</p></div>}
        </div>
      )
    } else {
      sideContent = (
        <div>
          {tree.map(node => (
            <FileTreeNode
              key={node.relPath}
              node={node}
              depth={0}
              collapsed={collapsed}
              selected={selected}
              onToggle={toggleDir}
              onSelect={(relPath) => void openFile(relPath)}
              onContextMenu={(relPath, x, y) => setSideMenu({ x, y, relPath })}
            />
          ))}
        </div>
      )
    }
  } else if (searchPattern.trim() === '') {
    sideContent = <div className="filex-center"><p>输入关键字搜索文件内容\n支持正则 / 大小写 / 全词匹配</p></div>
  } else if (searching) {
    sideContent = <div className="filex-center"><p>搜索中…</p></div>
  } else if (searchError) {
    sideContent = <div className="filex-center"><p className="filex-err">{searchError}</p></div>
  } else if (searchResults !== null && searchResults.results.length === 0) {
    sideContent = <div className="filex-center"><p>未找到匹配</p></div>
  } else if (searchResults !== null) {
    sideContent = (
      <div>
        {searchResults.truncated && <div className="filex-search-banner">结果超过 1000 条，已截断</div>}
        {groupedResults.map(group => (
          <div key={group.file} className="filex-search-group">
            <div className="filex-search-file">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              <span className="filex-search-file-name" title={group.file}>{group.file}</span>
              <span className="filex-search-file-count">{group.matches.length}</span>
            </div>
            {group.matches.map((match, mi) => {
              const segs = highlightSegments(match.text, match.highlights)
              return (
                <button
                  key={`${match.file}:${match.line}:${mi}`}
                  type="button"
                  className={`filex-search-row${selected === match.file && jumpLine === match.line ? ' filex-search-row-sel' : ''}`}
                  title={`${match.file}:${match.line}`}
                  onClick={() => void openFile(match.file, match)}
                  onContextMenu={(e) => { e.preventDefault(); setSideMenu({ x: e.clientX, y: e.clientY, relPath: match.file, line: match.line }) }}
                >
                  <span className="filex-search-line">{match.line}</span>
                  <span className="filex-search-text">
                    {segs.map((seg, si) => seg.hit
                      ? <mark key={si}>{seg.text}</mark>
                      : <span key={si}>{seg.text}</span>)}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    )
  } else {
    sideContent = <div className="filex-center"><p>未找到匹配</p></div>
  }

  let mainContent: JSX.Element
  if (openPath === null) {
    mainContent = (
      <div className="filex-placeholder">
        <p>从左侧选择文件进行预览 / 编辑</p>
      </div>
    )
  } else if (viewer === 'image' || viewer === 'pdf') {
    const url = mediaUrl(scope, openPath)
    mainContent = viewer === 'image'
      ? <div className="filex-media-wrap"><img className="filex-media-img" src={url} alt={openTitle} /></div>
      : <iframe className="filex-pdf" src={url} title={openTitle} />
  } else {
    mainContent = (
      <div className="filex-main">
        <TextEditor
          ctx={ctx}
          scope={scope}
          path={openPath}
          content={openContent}
          truncated={openTruncated}
          jumpLine={jumpLine}
          jumpRanges={jumpRanges}
          onSaved={onSaved}
        />
      </div>
    )
  }

  return (
    <>
    <div
      className="filex-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="filex-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="filex-header">
          <span className="filex-title">
            <span className="filex-title-text" title={openPath ?? ''}>
              {openPath ?? '文件预览 / 编辑'}
            </span>
          </span>
          <div className="filex-header-actions">
            {savedFlash !== '' && <span className="filex-badge">{savedFlash}</span>}
            <button
              type="button"
              className="filex-btn filex-btn-icon"
              title="关闭（Esc）"
              aria-label="关闭"
              onClick={onClose}
            >✕</button>
          </div>
        </div>
        <div className="filex-body">
          <div className="filex-side">
            <div className="filex-toolbar">
              <div className="filex-seg">
                <button
                  type="button"
                  className={`filex-seg-btn${searchMode === 'name' ? ' filex-seg-on' : ''}`}
                  onClick={() => setSearchMode('name')}
                  title="按文件名过滤"
                >文件名</button>
                <button
                  type="button"
                  className={`filex-seg-btn${searchMode === 'content' ? ' filex-seg-on' : ''}`}
                  onClick={() => setSearchMode('content')}
                  title="跨工作区搜索文件内容"
                >内容</button>
              </div>
              {searchMode === 'name' && (
                <button
                  type="button"
                  className="filex-btn filex-btn-icon"
                  disabled={loading}
                  onClick={() => void refresh()}
                  title="刷新文件列表"
                >⟳</button>
              )}
            </div>
            {root !== '' && <div className="filex-side-pad"><p className="filex-rootpath" title={root}>{root}</p></div>}
            {searchMode === 'name'
              ? (
                <div className="filex-side-pad">
                  <input
                    className="filex-input"
                    autoFocus
                    value={nameFilter}
                    onChange={(e) => setNameFilter(e.target.value)}
                    placeholder="按文件名过滤…（Ctrl+P 快速打开）"
                  />
                </div>
              )
              : (
                <div className="filex-searchbox">
                  <input
                    className="filex-input"
                    value={searchPattern}
                    onChange={(e) => setSearchPattern(e.target.value)}
                    placeholder="搜索文件内容…"
                  />
                  <div className="filex-search-opts">
                    <button type="button" className={`filex-opt${searchOptions.caseSensitive ? ' filex-opt-on' : ''}`} title="区分大小写" onClick={() => toggleOpt('caseSensitive')}>Aa</button>
                    <button type="button" className={`filex-opt${searchOptions.regex ? ' filex-opt-on' : ''}`} title="正则匹配" onClick={() => toggleOpt('regex')}>.*</button>
                    <button type="button" className={`filex-opt${searchOptions.wholeWord ? ' filex-opt-on' : ''}`} title="全词匹配" onClick={() => toggleOpt('wholeWord')}>ab</button>
                    <span className="filex-opt-sep" />
                    <button type="button" className={`filex-opt${showFilters ? ' filex-opt-on' : ''}`} title="包含 / 排除" onClick={() => setShowFilters(v => !v)}>⊕</button>
                  </div>
                  {showFilters && (
                    <div className="filex-filters">
                      <div className="filex-filter-row">
                        <span className="filex-filter-label">包含</span>
                        <input className="filex-input" value={includeStr} onChange={(e) => setIncludeStr(e.target.value)} placeholder="*.ts, src/**" />
                      </div>
                      <div className="filex-filter-row">
                        <span className="filex-filter-label">排除</span>
                        <input className="filex-input" value={excludeStr} onChange={(e) => setExcludeStr(e.target.value)} placeholder="dist, **/*.min.js" />
                      </div>
                      <p className="filex-filter-hint">逗号分隔多个模式；裸目录名自动匹配任意层级（dist ≡ **/dist/**）</p>
                    </div>
                  )}
                </div>
              )}
            {listTruncated && searchMode === 'name' && (
              <div className="filex-side-pad"><p className="filex-filter-hint">文件过多，列表已截断（最多 30000 个文件）</p></div>
            )}
            <div className="filex-scroll">{sideContent}</div>
          </div>
          {mainContent}
        </div>
        <div className="filex-status">
          <span className="filex-status-item">{openPath ? `${formatSize(0)}` : ''}</span>
          <span className="filex-status-hint">Ctrl+P 快速打开 · Esc 关闭</span>
        </div>
      </div>
      </div>
      {sideMenu !== null && createPortal(
        <div
          ref={sideMenuRef}
          className="filex-ctx-menu"
          style={{ left: sideMenu.x, top: sideMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {sideMenu.line !== undefined && (
            <button type="button" className="filex-ctx-item" onClick={() => insertSideRef(sideMenu.relPath, sideMenu.line)}>
              <span>插入该行引用到聊天框</span>
              <span className="filex-ctx-hint">{`@file:${sideMenu.relPath} lines:${sideMenu.line}`}</span>
            </button>
          )}
          <button type="button" className="filex-ctx-item" onClick={() => insertSideRef(sideMenu.relPath)}>
            <span>插入文件引用到聊天框</span>
            <span className="filex-ctx-hint">{`@file:${sideMenu.relPath}`}</span>
          </button>
        </div>,
        document.body,
      )}
      {sideToast !== '' && createPortal(
        <div className="filex-toast">
          <span className="filex-toast-title">插入聊天框失败</span>
          <span className="filex-toast-detail">{sideToast}</span>
        </div>,
        document.body,
      )}
    </>
  )
}
