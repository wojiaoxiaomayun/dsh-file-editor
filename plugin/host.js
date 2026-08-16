// DSH 动态插件「文件预览 / 编辑」 — Host 半部
// 通过 harness.handle 暴露 5 个 RPC 方法给浏览器端：
//   filex/root   解析当前会话工作区根目录
//   filex/list   递归列出工作区文件（跳过 node_modules/.git 等大目录）
//   filex/read   读取文件（文本/二进制检测/大文件截断预览）
//   filex/write  写回文件（路径越界校验 + 沙箱策略）
//   filex/search 全文搜索（正则/大小写/全词/包含排除）
//
// 用法：这段代码是 cordis_define code.host 的函数体（以 return {...} 结尾），
// 配合 client.js（code.client）组合为一个动态 Cordis 插件 Package。
return {
  apply(ctx) {
    // ---------- service accessors (optional, undefined-checked) ----------
    const fsSvc = () => ctx.get('fs')
    const policySvc = () => ctx.get('sandboxPolicy')
    const sessionsSvc = () => ctx.get('sessions')

    // ---------- constants ----------
    const IGNORED_DIRS = new Set([
      'node_modules', '.git', '.hg', '.svn', '.dsh', '.next', '.nuxt', '.output',
      'dist', 'build', 'out', 'coverage', '.turbo', '.cache', '.yarn', '.pnpm-store',
      'target', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache',
      '.idea', '.vscode', 'release', 'vendor', 'bin', 'obj', '.expo', 'Pods', 'DerivedData'
    ])
    const MAX_FILES = 30000
    const TEXT_READ_LIMIT = 512 * 1024      // bytes: plain readText below this, stream above
    const MAX_PREVIEW = 1024 * 1024         // preview cap (chars)
    const MAX_SEARCH_FILE = 1024 * 1024     // skip files larger than this in content search
    const MAX_SEARCH_MATCHES = 1000
    const MAX_MEDIA = 30 * 1024 * 1024      // bytes: image / pdf preview cap
    const EXT_MIME = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
      pdf: 'application/pdf'
    }

    // ---------- helpers ----------
    function errMsg(err) {
      if (err && typeof err === 'object' && typeof err.message === 'string') return err.message
      return String(err)
    }
    function isBinaryError(err) {
      if (err && typeof err === 'object') {
        if (err.code === 'FS_NOT_TEXT') return true
        if (typeof err.message === 'string' && /binary/i.test(err.message)) return true
      }
      return false
    }
    function escapeRegExp(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    function buildRegex(pattern, opts) {
      const flags = opts && opts.caseSensitive ? 'g' : 'gi'
      let source = opts && opts.regex ? pattern : escapeRegExp(pattern)
      if (opts && opts.wholeWord) source = '\\b(?:' + source + ')\\b'
      return new RegExp(source, flags)
    }
    function globToRegExp(glob) {
      let out = ''
      for (let i = 0; i < glob.length; i++) {
        const ch = glob[i]
        if (ch === '*') {
          if (glob[i + 1] === '*') { out += '.*'; i++ }
          else out += '[^/]*'
        } else if (ch === '?') out += '[^/]'
        else out += escapeRegExp(ch)
      }
      return new RegExp('^' + out + '$')
    }
    const GLOB_META = /[*?{\[]/
    function parseGlobList(raw) {
      if (!Array.isArray(raw)) return []
      const out = []
      for (const t of raw) {
        const token = String(t).trim()
        if (!token) continue
        out.push(globToRegExp(GLOB_META.test(token) ? token : '**/' + token + '/**'))
      }
      return out
    }

    // workspace root: session cwd first, sandbox-policy root as fallback
    function rootFor(sessionId) {
      const sessions = sessionsSvc()
      let session
      if (sessionId && sessions && typeof sessions.get === 'function') session = sessions.get(sessionId)
      if (session && session.header && session.header.cwd) return { root: session.header.cwd, session }
      const policy = policySvc()
      if (policy && policy.workspaceRoot) return { root: policy.workspaceRoot, session }
      return { root: undefined, session }
    }

    async function resolveWithinRoot(root, relPath) {
      const fs = fsSvc()
      if (!fs) throw new Error('fs 服务不可用')
      const rootTarget = await fs.resolve(root)
      const target = await fs.resolve(relPath, { cwd: root })
      if (!fs.contains(rootTarget, target)) throw new Error('路径在工作区之外: ' + relPath)
      return { rootTarget, target }
    }

    // recursive walk; onFile(entry, relPath) may return false to stop
    async function walkFiles(rootTarget, onFile, state) {
      const fs = fsSvc()
      const queue = [{ target: rootTarget, rel: '' }]
      while (queue.length > 0) {
        if (state.truncated) return
        const cur = queue.pop()
        let entries
        try { entries = await fs.listDir(cur.target) } catch (err) { continue }
        for (let i = entries.length - 1; i >= 0; i--) {
          if (state.truncated) return
          const entry = entries[i]
          const childRel = cur.rel ? cur.rel + '/' + entry.name : entry.name
          if (entry.type === 'directory') {
            if (IGNORED_DIRS.has(entry.name)) continue
            queue.push({ target: entry.target, rel: childRel })
          } else if (entry.type === 'file') {
            state.files++
            const keep = await onFile(entry, childRel)
            if (keep === false) { state.truncated = true; return }
            if (state.files >= MAX_FILES) { state.truncated = true; return }
          }
        }
      }
    }

    // ---------- RPC: workspace root ----------
    harness.handle('filex/root', async (args) => {
      try {
        const { root } = rootFor(args && args.sessionId)
        if (!root) return { ok: false, error: '没有可用的工作区（当前会话未设置 cwd）' }
        const fs = fsSvc()
        const rootTarget = await fs.resolve(root)
        return { ok: true, root: fs.processPath(rootTarget) }
      } catch (err) { return { ok: false, error: errMsg(err) } }
    })

    // ---------- RPC: file list ----------
    harness.handle('filex/list', async (args) => {
      try {
        const { root } = rootFor(args && args.sessionId)
        if (!root) return { ok: false, error: '没有可用的工作区（当前会话未设置 cwd）' }
        const fs = fsSvc()
        const rootTarget = await fs.resolve(root)
        const files = []
        const state = { files: 0, truncated: false }
        await walkFiles(rootTarget, (entry, rel) => {
          files.push({ name: entry.name, relPath: rel, size: entry.size || 0 })
          return true
        }, state)
        files.sort(function (a, b) { return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0 })
        return { ok: true, root: fs.processPath(rootTarget), files, truncated: state.truncated }
      } catch (err) { return { ok: false, error: errMsg(err) } }
    })

    // ---------- RPC: read file ----------
    harness.handle('filex/read', async (args) => {
      try {
        const { root } = rootFor(args && args.sessionId)
        if (!root) return { ok: false, error: '没有可用的工作区（当前会话未设置 cwd）' }
        const relPath = args && typeof args.relPath === 'string' ? args.relPath : ''
        if (!relPath) return { ok: false, error: '缺少文件路径' }
        const { target } = await resolveWithinRoot(root, relPath)
        const fs = fsSvc()
        const info = await fs.stat(target)
        if (!info) return { ok: false, error: '文件不存在: ' + relPath }
        if (info.type !== 'file') return { ok: false, error: '不是普通文件: ' + relPath }
        const size = info.size || 0
        try {
          if (size > TEXT_READ_LIMIT) {
            const iter = await fs.streamText(target)
            let content = ''
            let truncated = false
            while (true) {
              const step = await iter.next()
              if (step.done) break
              content += step.value
              if (content.length >= MAX_PREVIEW) { truncated = true; break }
            }
            return {
              ok: true, kind: 'text', size,
              content: content.slice(0, MAX_PREVIEW),
              truncated: truncated || size > MAX_PREVIEW
            }
          }
          const content = await fs.readText(target)
          return { ok: true, kind: 'text', size, content, truncated: false }
        } catch (err) {
          if (isBinaryError(err)) return { ok: true, kind: 'binary', size }
          return { ok: false, error: errMsg(err) }
        }
      } catch (err) { return { ok: false, error: errMsg(err) } }
    })

    // ---------- RPC: write file ----------
    harness.handle('filex/write', async (args) => {
      try {
        const { root, session } = rootFor(args && args.sessionId)
        if (!root) return { ok: false, error: '没有可用的工作区（当前会话未设置 cwd）' }
        const relPath = args && typeof args.relPath === 'string' ? args.relPath : ''
        const content = args && typeof args.content === 'string' ? args.content : ''
        if (!relPath) return { ok: false, error: '缺少文件路径' }
        const { target } = await resolveWithinRoot(root, relPath)
        const fs = fsSvc()
        const policy = policySvc()
        const sandboxPolicy = policy ? policy.resolve({ session: session || undefined }) : undefined
        await fs.writeText(target, content, undefined, undefined, sandboxPolicy)
        return { ok: true }
      } catch (err) { return { ok: false, error: errMsg(err) } }
    })

    // ---------- RPC: media (image / pdf bytes as base64) ----------
    harness.handle('filex/media', async (args) => {
      try {
        const { root } = rootFor(args && args.sessionId)
        if (!root) return { ok: false, error: '没有可用的工作区（当前会话未设置 cwd）' }
        const relPath = args && typeof args.relPath === 'string' ? args.relPath : ''
        if (!relPath) return { ok: false, error: '缺少文件路径' }
        const { target } = await resolveWithinRoot(root, relPath)
        const fs = fsSvc()
        const info = await fs.stat(target)
        if (!info) return { ok: false, error: '文件不存在: ' + relPath }
        if (info.type !== 'file') return { ok: false, error: '不是普通文件: ' + relPath }
        const dot = relPath.lastIndexOf('.')
        const ext = dot >= 0 ? relPath.slice(dot + 1).toLowerCase() : ''
        const mime = EXT_MIME[ext]
        if (!mime) return { ok: false, error: '不支持的文件类型: ' + ext }
        let bytes
        try { bytes = await fs.readBytes(target, undefined, MAX_MEDIA) }
        catch (err) {
          if (err && err.code === 'FS_TOO_LARGE') return { ok: false, error: '文件过大（超过 30MB），无法预览' }
          return { ok: false, error: errMsg(err) }
        }
        // Uint8Array -> latin1 binary string -> base64 (chunked decode)
        const bin = new TextDecoder('latin1').decode(bytes)
        return { ok: true, mime, base64: btoa(bin), size: bytes.length }
      } catch (err) { return { ok: false, error: errMsg(err) } }
    })

    // ---------- RPC: content search ----------
    harness.handle('filex/search', async (args) => {
      try {
        const { root } = rootFor(args && args.sessionId)
        if (!root) return { ok: false, error: '没有可用的工作区（当前会话未设置 cwd）' }
        const pattern = args && typeof args.pattern === 'string' ? args.pattern.trim() : ''
        if (!pattern) return { ok: true, results: [], truncated: false }
        const opts = args && args.options && typeof args.options === 'object' ? args.options : {}
        let re
        try { re = buildRegex(pattern, opts) } catch (err) { return { ok: false, error: '无效的正则表达式: ' + errMsg(err) } }
        const include = parseGlobList(args && args.include)
        const exclude = parseGlobList(args && args.exclude)
        const fs = fsSvc()
        const rootTarget = await fs.resolve(root)
        const results = []
        let truncated = false
        const state = { files: 0, truncated: false }
        await walkFiles(rootTarget, async (entry, rel) => {
          if (include.length > 0) {
            let hit = false
            for (const rx of include) if (rx.test(rel)) { hit = true; break }
            if (!hit) return true
          }
          for (const rx of exclude) if (rx.test(rel)) return true
          if ((entry.size || 0) > MAX_SEARCH_FILE) return true
          let text
          try { text = await fs.readText(entry.target) } catch (err) { return true }
          const lines = text.split('\n')
          for (let i = 0; i < lines.length; i++) {
            re.lastIndex = 0
            let m
            const highlights = []
            while ((m = re.exec(lines[i])) !== null) {
              highlights.push({ start: m.index, end: m.index + m[0].length })
              if (m[0].length === 0) re.lastIndex++
              if (highlights.length >= 200) break
            }
            if (highlights.length > 0) {
              results.push({ file: rel, line: i + 1, text: lines[i], highlights })
              if (results.length >= MAX_SEARCH_MATCHES) { truncated = true; return false }
            }
          }
          return true
        }, state)
        return { ok: true, results, truncated }
      } catch (err) { return { ok: false, error: errMsg(err) } }
    })
  }
}
