/**
 * The file explorer modal: left panel (file tree / name filter / content
 * search) and right panel (viewer: code editor, image / pdf). Built on the
 * /filex API. The chrome composes the web shell's design-system primitives
 * (Modal / Button / Input / Menu / Toast) so the surface follows the active
 * theme; only the bespoke split layout and dense rows carry local CSS.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  Button,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconRefreshOutline14,
  IconRightUpOutline16,
  IconWarningOutline16,
  Input,
  Menu,
  Modal,
  Toast,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import { api, mediaUrl, type FsEntry, type SearchMatch, type SessionScope } from './api.ts'
import { FileIcon } from './file-icon.tsx'
import { TextEditor } from './TextEditor.tsx'
import { appendToDraft } from './draft.ts'
import { detectDark } from './style.ts'

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
  light: boolean
  onToggle: (relPath: string) => void
  onSelect: (relPath: string) => void
  onContextMenu: (relPath: string, x: number, y: number) => void
}

function FileTreeNode(props: FileTreeNodeProps): JSX.Element {
  const { node, depth, collapsed, selected, light, onToggle, onSelect, onContextMenu } = props
  if (node.kind === 'dir') {
    const open = !collapsed.has(node.relPath)
    return (
      <div className="filex-tree-group">
        <button
          type="button"
          className={`filex-node${open ? ' filex-node-open' : ''}${selected === node.relPath ? ' filex-node-sel' : ''}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => onToggle(node.relPath)}
          onContextMenu={(e) => { e.preventDefault(); onContextMenu(node.relPath, e.clientX, e.clientY) }}
        >
          <IconChevronRightOutline14 className="filex-chev" />
          <FileIcon kind="dir" name={node.name} open={open} light={light} />
          <span className="filex-node-name" title={node.relPath}>{node.name}</span>
        </button>
        {open && node.children.map(child => (
          <FileTreeNode
            key={child.relPath}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            selected={selected}
            light={light}
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
      <span className="filex-chev" />
      <FileIcon kind="file" path={node.relPath} light={light} />
      <span className="filex-node-name">{node.name}</span>
    </button>
  )
}

interface ExplorerModalProps {
  ctx: Context
  scope: SessionScope
  /**
   * Absolute path a chat-side path click asked the modal to open. The seq
   * bumps on every request so a repeat click re-opens while the modal stays
   * mounted; null means "no pending open" (plain explorer open).
   */
  openFileRequest?: { path: string; seq: number } | null
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
  const [toastKey, setToastKey] = useState(0)
  const sideAnchorRef = useRef<HTMLSpanElement | null>(null)
  const searchSeq = useRef(0)
  const cmEscapeRef = useRef(false)

  // vscode-icons art has light-theme variants for a few glyphs; pick them on light surfaces.
  const lightTheme = useMemo(() => !detectDark(), [])

  // Escape while the CodeMirror search panel is focused belongs to the panel
  // (close the panel, keep the explorer). The primitives Modal closes on any
  // Escape via a document bubble listener; a capture-phase keydown listener
  // records the case first (capture always precedes bubble regardless of
  // registration order) so handleClose can decline that single close request.
  // Pointer interactions reset the flag so a later mask/button close still
  // goes through.
  useEffect(() => {
    const onKeyCapture = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      cmEscapeRef.current = target !== null && target.closest('.cm-panel') !== null
    }
    const resetFlag = (): void => { cmEscapeRef.current = false }
    document.addEventListener('keydown', onKeyCapture, true)
    document.addEventListener('pointerdown', resetFlag, true)
    return () => {
      document.removeEventListener('keydown', onKeyCapture, true)
      document.removeEventListener('pointerdown', resetFlag, true)
    }
  }, [])

  const handleClose = useCallback((): void => {
    if (cmEscapeRef.current) {
      cmEscapeRef.current = false
      return
    }
    onClose()
  }, [onClose])

  const showSideToast = (text: string): void => {
    setSideToast(text)
    setToastKey(k => k + 1)
  }

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
    // Normalize separators so absolute Windows paths (backslashes) flow
    // through the same '/' based tree / title / media logic as tree rows.
    const norm = relPath.replace(/\\/g, '/')
    setSelected(norm)
    setOpenPath(norm)
    setOpenTitle(norm.split('/').pop() ?? norm)
    const vw = viewerFor(norm)
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
      const result = await api.fsRead(scope, norm)
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

  // Chat-path interception: when a path click asked this modal to open a
  // file, load it — on mount, and again on every new request seq while the
  // modal stays open (clicking another path switches the open file).
  const openFileRequest = props.openFileRequest
  useEffect(() => {
    if (openFileRequest === null || openFileRequest === undefined) return
    void openFile(openFileRequest.path)
  }, [openFileRequest?.seq])

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
    if (!result.ok) showSideToast(result.reason ?? '插入失败')
  }

  const sideMenuItems: MenuEntry[] = sideMenu !== null
    ? [
      ...(sideMenu.line !== undefined
        ? [{
            id: 'insertLine',
            label: (
              <span className="filex-ctx-label">
                <span>插入该行引用到聊天框</span>
                <span className="filex-ctx-hint">{`@file:${sideMenu.relPath} lines:${sideMenu.line}`}</span>
              </span>
            ),
            icon: <IconRightUpOutline16 />,
          } as MenuEntry]
        : []),
      {
        id: 'insertFile',
        label: (
          <span className="filex-ctx-label">
            <span>插入文件引用到聊天框</span>
            <span className="filex-ctx-hint">{`@file:${sideMenu.relPath}`}</span>
          </span>
        ),
        icon: <IconRightUpOutline16 />,
      },
    ]
    : []

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
                <FileIcon kind="file" path={f.relPath} light={lightTheme} />
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
              light={lightTheme}
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
              <FileIcon kind="file" path={group.file} light={lightTheme} />
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
      <Modal
        open
        headless
        className="filex-modal"
        title={openPath ?? '文件预览 / 编辑'}
        closeLabel="关闭"
        onClose={handleClose}
      >
        <div className="filex-explorer">
          <div className="filex-explorer-header">
            <span className="filex-title">
              <span className="filex-title-text" title={openPath ?? ''}>
                {openPath ?? '文件预览 / 编辑'}
              </span>
            </span>
            <div className="filex-header-actions">
              {savedFlash !== '' && (
                <span className={`filex-badge${savedFlash.startsWith('保存失败') ? ' filex-badge-warn' : ''}`}>{savedFlash}</span>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={<IconCloseOutline16 />}
                title="关闭（Esc）"
                aria-label="关闭"
                onClick={handleClose}
              />
            </div>
          </div>
          <div className="filex-explorer-body">
            <aside className="filex-side">
              <div className="filex-toolbar">
                <div className="filex-seg">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={`filex-seg-btn${searchMode === 'name' ? ' filex-seg-on' : ''}`}
                    onClick={() => setSearchMode('name')}
                    title="按文件名过滤"
                  >文件名</Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={`filex-seg-btn${searchMode === 'content' ? ' filex-seg-on' : ''}`}
                    onClick={() => setSearchMode('content')}
                    title="跨工作区搜索文件内容"
                  >内容</Button>
                </div>
                {searchMode === 'name' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    icon={<IconRefreshOutline14 />}
                    disabled={loading}
                    onClick={() => void refresh()}
                    title="刷新文件列表"
                    aria-label="刷新文件列表"
                  />
                )}
              </div>
              {root !== '' && <div className="filex-side-pad"><p className="filex-rootpath" title={root}>{root}</p></div>}
              {searchMode === 'name'
                ? (
                  <div className="filex-side-pad">
                    <Input
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
                    <Input
                      className="filex-input"
                      value={searchPattern}
                      onChange={(e) => setSearchPattern(e.target.value)}
                      placeholder="搜索文件内容…"
                    />
                    <div className="filex-search-opts">
                      <Button type="button" size="sm" variant="ghost" className={`filex-opt${searchOptions.caseSensitive ? ' filex-opt-on' : ''}`} title="区分大小写" onClick={() => toggleOpt('caseSensitive')}>Aa</Button>
                      <Button type="button" size="sm" variant="ghost" className={`filex-opt${searchOptions.regex ? ' filex-opt-on' : ''}`} title="正则匹配" onClick={() => toggleOpt('regex')}>.*</Button>
                      <Button type="button" size="sm" variant="ghost" className={`filex-opt${searchOptions.wholeWord ? ' filex-opt-on' : ''}`} title="全词匹配" onClick={() => toggleOpt('wholeWord')}>ab</Button>
                      <span className="filex-opt-sep" />
                      <Button type="button" size="sm" variant="ghost" className={`filex-opt${showFilters ? ' filex-opt-on' : ''}`} title="包含 / 排除" onClick={() => setShowFilters(v => !v)}>⊕</Button>
                    </div>
                    {showFilters && (
                      <div className="filex-filters">
                        <div className="filex-filter-row">
                          <span className="filex-filter-label">包含</span>
                          <Input className="filex-input" value={includeStr} onChange={(e) => setIncludeStr(e.target.value)} placeholder="*.ts, src/**" />
                        </div>
                        <div className="filex-filter-row">
                          <span className="filex-filter-label">排除</span>
                          <Input className="filex-input" value={excludeStr} onChange={(e) => setExcludeStr(e.target.value)} placeholder="dist, **/*.min.js" />
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
            </aside>
            {mainContent}
          </div>
          <div className="filex-status">
            <span className="filex-status-item">{openPath !== null ? openTitle : ''}</span>
            <span className="filex-status-hint">Ctrl+P 快速打开 · Esc 关闭</span>
          </div>
        </div>
      </Modal>
      {sideMenu !== null && (
        <Menu
          open
          portal
          compact
          align="start"
          anchor={<span ref={sideAnchorRef} className="filex-ctx-anchor" style={{ left: sideMenu.x, top: sideMenu.y }} />}
          getAnchorRect={() => sideAnchorRef.current?.getBoundingClientRect() ?? null}
          items={sideMenuItems}
          onSelect={(id) => {
            if (sideMenu === null) return
            if (id === 'insertLine' && sideMenu.line !== undefined) insertSideRef(sideMenu.relPath, sideMenu.line)
            else insertSideRef(sideMenu.relPath)
          }}
          onClose={() => setSideMenu(null)}
        />
      )}
      {sideToast !== '' && (
        <Toast
          key={toastKey}
          text={`插入聊天框失败：${sideToast}`}
          icon={<IconWarningOutline16 />}
          onDone={() => setSideToast('')}
        />
      )}
    </>
  )
}
