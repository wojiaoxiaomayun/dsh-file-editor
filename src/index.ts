/**
 * dsh-file-explorer host half: the /filex JSON API (session cwd, file list,
 * read / write / content search) and the /filex/file media route (images /
 * PDFs). Every route passes the same loopback browser-trust fence.
 *
 * All operations are conversation-scoped: requests carry a sessionId and the
 * session's authoritative cwd comes from the session store.
 */
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { Context, FilexHttpRequest } from './context-types.ts'
import { isTrustedApiRequest } from './trust-fence.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-file-explorer'

/** Services required before mounting: the webserver routes and the session store. */
export const inject = ['webServer', 'sessions']

/** Media content types by extension. */
const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
}

/** Directories never listed by the explorer / search. */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.dsh', '.next', '.nuxt', '.output',
  'dist', 'build', 'out', 'coverage', '.turbo', '.cache', '.yarn', '.pnpm-store',
  'target', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.idea', '.vscode', 'release', 'vendor', 'bin', 'obj', '.expo', 'Pods', 'DerivedData',
])

const MAX_FILES = 30000
const TEXT_READ_LIMIT = 512 * 1024
const MAX_PREVIEW = 1024 * 1024
const MAX_SEARCH_FILE = 1024 * 1024
const MAX_SEARCH_MATCHES = 1000
const MAX_MEDIA = 30 * 1024 * 1024

/** One wire failure carrying a stable code. */
class FilexError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || value === '') {
    throw new FilexError('bad-request', `missing or invalid "${key}"`)
  }
  return value
}

function requireAbsolute(raw: string): string {
  if (!isAbsolute(raw)) throw new FilexError('bad-request', `path must be absolute: "${raw}"`)
  return resolve(raw)
}

/** Resolve a request path (absolute or cwd-relative) and fence it inside the session cwd. */
function resolvePathWithin(cwd: string, raw: string): string {
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(join(cwd, raw))
  if (!isWithin(cwd, abs)) throw new FilexError('forbidden', 'path outside the session working directory', 403)
  return abs
}

/** Canonical containment check (case-aware on Windows, separator-normalized). */
export function isWithin(parent: string, child: string): boolean {
  const p = resolve(parent)
  const c = resolve(child)
  if (c === p) return true
  const sep = c.startsWith(p + '\\') || c.startsWith(p + '/')
  return sep || c.startsWith(p + '\\') || c.startsWith(p + '/')
}

/** Resolve a session's authoritative working directory (header cwd first, process cwd last). */
function sessionCwdOf(ctx: Context, sessionId: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header.cwd
  if (headerCwd !== undefined && headerCwd !== '') return resolve(headerCwd)
  return process.cwd()
}

async function readJsonBody(req: FilexHttpRequest): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) {
    raw += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  }
  if (raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // fall through to the error below
  }
  throw new FilexError('bad-request', 'invalid JSON body')
}

function writeJson(res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: string | Uint8Array): void }, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

function writeOk(res: Parameters<typeof writeJson>[0], value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

function writeError(res: Parameters<typeof writeJson>[0], error: unknown): void {
  if (error instanceof FilexError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

/**
 * Recursively walk a directory tree, invoking onFile for every regular file.
 * Skips IGNORED_DIRS; stops at MAX_FILES. The callback may return false to
 * stop early (or a Promise resolving to false / void for async callbacks).
 */
async function walkFiles(cwd: string, onFile: (abs: string, rel: string, size: number) => unknown): Promise<boolean> {
  let count = 0
  let truncated = false
  const queue: Array<{ abs: string; rel: string }> = [{ abs: cwd, rel: '' }]
  while (queue.length > 0) {
    if (truncated) break
    const cur = queue.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(cur.abs, { withFileTypes: true }) as Dirent[]
    } catch {
      continue
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      if (truncated) break
      const entry = entries[i]
      const childAbs = join(cur.abs, entry.name)
      const childRel = cur.rel === '' ? entry.name : `${cur.rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        queue.push({ abs: childAbs, rel: childRel })
      } else if (entry.isFile()) {
        count++
        let size = 0
        try {
          const info = await stat(childAbs)
          size = info.size
        } catch {
          size = 0
        }
        const keep = onFile(childAbs, childRel, size)
        if (keep === false) truncated = true
        else if (count >= MAX_FILES) truncated = true
      }
    }
  }
  return truncated
}

/** Text read with the size cap; binary detection via NUL probe. */
async function readTextFile(path: string): Promise<{ kind: 'text'; content: string; size: number; truncated: boolean } | { kind: 'binary'; size: number; truncated: boolean }> {
  const info = await stat(path).catch(() => {
    throw new FilexError('fs-error', `cannot read "${path}": not found`, 404)
  })
  if (info.isDirectory()) throw new FilexError('fs-error', `"${path}" is a directory`)
  const size = info.size
  const truncated = size > MAX_PREVIEW
  const handle = await open(path, 'r').catch((error: unknown) => {
    throw new FilexError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`)
  })
  try {
    const length = Math.min(size, MAX_PREVIEW)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    const slice = buffer.subarray(0, bytesRead)
    if (slice.includes(0)) return { kind: 'binary', size, truncated }
    return { kind: 'text', content: slice.toString('utf8'), size, truncated }
  } finally {
    await handle.close()
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildRegex(pattern: string, opts: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean }): RegExp {
  const flags = opts.caseSensitive === true ? 'g' : 'gi'
  let source = opts.regex === true ? pattern : escapeRegExp(pattern)
  if (opts.wholeWord === true) source = `\\b(?:${source})\\b`
  return new RegExp(source, flags)
}

function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i++ }
      else out += '[^/]*'
    } else if (ch === '?') out += '[^/]'
    else out += escapeRegExp(ch)
  }
  return new RegExp(`^${out}$`)
}

const GLOB_META = /[*?{\[]/

function parseGlobList(raw: unknown): RegExp[] {
  if (!Array.isArray(raw)) return []
  const out: RegExp[] = []
  for (const item of raw) {
    const token = String(item).trim()
    if (token === '') continue
    out.push(globToRegExp(GLOB_META.test(token) ? token : `**/${token}/**`))
  }
  return out
}

type ApiMethod = (payload: Record<string, unknown>) => Promise<unknown> | unknown

function buildApi(ctx: Context): Record<string, ApiMethod> {
  const cwdOf = (payload: Record<string, unknown>): { sessionId: string; cwd: string } => {
    const sessionId = requireString(payload, 'sessionId')
    return { sessionId, cwd: sessionCwdOf(ctx, sessionId) }
  }
  return {
    'session.cwd': (payload) => {
      const { sessionId, cwd } = cwdOf(payload)
      return { sessionId, cwd, root: basename(cwd) }
    },
    'fs.list': async (payload) => {
      const { cwd } = cwdOf(payload)
      const files: Array<{ name: string; relPath: string; size: number }> = []
      const truncated = await walkFiles(cwd, (_abs, rel, size) => {
        files.push({ name: rel.split('/').pop() ?? rel, relPath: rel, size })
        return true
      })
      files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
      return { root: cwd, files, truncated }
    },
    'fs.read': async (payload) => {
      const { cwd } = cwdOf(payload)
      const raw = requireString(payload, 'path')
      const path = resolvePathWithin(cwd, raw)
      return readTextFile(path)
    },
    'fs.write': async (payload) => {
      const { cwd } = cwdOf(payload)
      const raw = requireString(payload, 'path')
      const content = requireString(payload, 'content')
      const path = resolvePathWithin(cwd, raw)
      const tmp = `${path}.dsh-filex-tmp-${process.pid}`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, content, 'utf8')
        await rename(tmp, path)
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => {})
        throw new FilexError('fs-error', `cannot write "${path}": ${error instanceof Error ? error.message : String(error)}`)
      }
      return { ok: true }
    },
    'fs.search': async (payload) => {
      const { cwd } = cwdOf(payload)
      const pattern = requireString(payload, 'pattern').trim()
      if (pattern === '') return { results: [], truncated: false }
      const record = payload as { options?: unknown; include?: unknown; exclude?: unknown }
      const opts = typeof record.options === 'object' && record.options !== null
        ? record.options as { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean }
        : {}
      let re: RegExp
      try {
        re = buildRegex(pattern, opts)
      } catch (error) {
        throw new FilexError('bad-request', `invalid regular expression: ${error instanceof Error ? error.message : String(error)}`)
      }
      const include = parseGlobList(record.include)
      const exclude = parseGlobList(record.exclude)
      const results: Array<{ file: string; line: number; text: string; highlights: Array<{ start: number; end: number }> }> = []
      let truncated = false
      await walkFiles(cwd, async (abs, rel, size) => {
        if (include.length > 0 && !include.some(rx => rx.test(rel))) return true
        if (exclude.some(rx => rx.test(rel))) return true
        if (size > MAX_SEARCH_FILE) return true
        let text: string
        try {
          const result = await readTextFile(abs)
          if (result.kind !== 'text') return true
          text = result.content
        } catch {
          return true
        }
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          re.lastIndex = 0
          const highlights: Array<{ start: number; end: number }> = []
          let match: RegExpExecArray | null
          while ((match = re.exec(lines[i])) !== null) {
            highlights.push({ start: match.index, end: match.index + match[0].length })
            if (match[0].length === 0) re.lastIndex++
            if (highlights.length >= 200) break
          }
          if (highlights.length > 0) {
            results.push({ file: rel, line: i + 1, text: lines[i], highlights })
            if (results.length >= MAX_SEARCH_MATCHES) {
              truncated = true
              return false
            }
          }
        }
        return true
      })
      return { results, truncated }
    },
  }
}

export function apply(ctx: Context): void {
  const fence = (req: { headers: Record<string, string | string[] | undefined> }): boolean =>
    isTrustedApiRequest(req as { headers: import('node:http').IncomingHttpHeaders })

  const api = buildApi(ctx)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/filex/api',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith('/filex/api/') ? pathname.slice('/filex/api/'.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new FilexError('not-found', 'unknown filex API method', 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        const handler = api[method]
        if (handler === undefined) {
          throw new FilexError('not-found', `unknown filex API method "${method}"`, 404)
        }
        writeOk(res, await handler(payload))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-file-explorer: /filex/api routes')

  // ── Media route (images / PDFs for the editor) ────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/filex/file',
    handler: async (req, res) => {
      if (!fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const sessionId = url.searchParams.get('sessionId')
        const raw = url.searchParams.get('path')
        if (sessionId === null || raw === null) throw new FilexError('bad-request', 'sessionId and path are required')
        const cwd = sessionCwdOf(ctx, sessionId)
        const path = resolvePathWithin(cwd, raw)
        const info = await stat(path)
        if (!info.isFile() || info.size > MAX_MEDIA) {
          throw new FilexError('fs-error', 'not a file or too large')
        }
        const lower = path.toLowerCase()
        const type = Object.keys(MEDIA_TYPES).find(ext => lower.endsWith(ext))
        const headers: Record<string, string> = {
          'content-type': type ? MEDIA_TYPES[type] : 'application/octet-stream',
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        }
        if (url.searchParams.get('download') === '1') {
          headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(basename(path))}`
        }
        const body = await readFile(path)
        res.writeHead(200, headers)
        res.end(body)
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-file-explorer: /filex/file media route')
}
