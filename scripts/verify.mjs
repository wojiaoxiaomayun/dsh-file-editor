/**
 * Live-GUI verification for dsh-file-explorer (local dev helper):
 *   1. hero phase — the floating ButtonGroup sits at the conversation
 *      column's top-right (top ≈ +14, right gap ≈ 28, z-index auto) and
 *      clicking it opens the explorer modal;
 *   2. opening a session with records — the floating icon hides and the
 *      header utilities icon takes over (no duplicate);
 *   3. clicking a chat file link (tool-row fileLink) — the explorer modal
 *      opens with the file loaded in the editor.
 *
 * Mints the browser-session cookie from ~/.dsh/.credentials.yaml and drives
 * a headless Chrome via CDP. Usage:
 *   node scripts/verify.mjs [--port <gui port>]   (default 53048)
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '53048'
const CDP = 9600
const APP = `http://127.0.0.1:${PORT}/`
const AUTHORITY = `127.0.0.1:${PORT}`

const b64u = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const unB64u = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); return Buffer.from(s.replaceAll('-', '+').replaceAll('_', '/') + p, 'base64') }
const secretLine = readFileSync(join(process.env.USERPROFILE, '.dsh', '.credentials.yaml'), 'utf8').split('\n').find((l) => l.includes('secret:'))
const secret = unB64u(secretLine.split('secret:')[1].trim())
const cookieName = 'dsh-auth-' + b64u(createHash('sha256').update(AUTHORITY).digest())
const now = Date.now(); const expiresAt = now + 30 * 24 * 3600 * 1000
const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt: now, expiresAt }), 'utf8'))
const cookieValue = 'v1.' + body + '.' + b64u(createHmac('sha256', secret).update(body).digest())

let seq = 0
const pending = new Map()
let ws
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const connect = (url) => new Promise((resolve, reject) => {
  ws = new WebSocket(url)
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('ws'))
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id !== undefined) {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
    }
  }
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  return r.result?.value ?? 'THREW:' + JSON.stringify(r.exceptionDetails)
}

const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${CDP}`,
  '--user-data-dir=' + join(root, '.dsh-vision-toolkit', 'artifacts', 'hero-verify', 'chrome-profile-verify'),
  'about:blank',
], { stdio: 'ignore' })

try {
  let v = null
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP}/json/version`)
      if (r.ok) { v = await r.json(); break }
    } catch { /* retry */ }
    await sleep(300)
  }
  if (!v) throw new Error('chrome CDP did not come up')
  const t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json()
  await connect(t.webSocketDebuggerUrl)
  await send('Network.enable')
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Network.setCookie', { name: cookieName, value: cookieValue, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Strict' })
  await send('Page.navigate', { url: APP })
  await sleep(15000)

  // 1. hero FAB position + click
  console.log('[1] hero:', await evalJs(`(() => {
    const fab = document.querySelector('.filex-hero-fab')
    const g = document.querySelector('.filex-group')
    const col = document.querySelector('[data-phase]')
    if (!fab || !g || !col) return JSON.stringify({ fab: !!fab, phase: col?.getAttribute('data-phase') ?? null })
    const fr = fab.getBoundingClientRect()
    const cr = col.getBoundingClientRect()
    return JSON.stringify({
      phase: col.getAttribute('data-phase'),
      inFab: fab.contains(g),
      top: Math.round(fr.top), expectTop: Math.round(cr.top + 14),
      rightGap: Math.round(window.innerWidth - fr.right - cr.right), expectRightGap: 28,
      zIndex: getComputedStyle(fab).zIndex,
    })
  })()`))
  console.log('[1] click:', await evalJs(`(() => { const b = document.querySelector('.filex-hero-fab .filex-group-main'); if (!b) return 'no-btn'; b.click(); return 'clicked' })()`))
  await sleep(3500)
  console.log('[1] modal:', await evalJs(`JSON.stringify({ modal: !!document.querySelector('.filex-modal') })`))
  await evalJs(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })()`)
  await sleep(1200)

  // 2. open a session with records
  await evalJs(`(() => { const rows = document.querySelectorAll('[data-slot="sidebar.workspaces"] [role="treeitem"]'); for (const r of rows) { if ((r.textContent || '').includes('当前图标')) { r.click(); return } } })()`)
  await sleep(11000)
  console.log('[2] session:', await evalJs(`JSON.stringify({
    phase: document.querySelector('[data-phase]')?.getAttribute('data-phase'),
    fabHidden: !document.querySelector('.filex-hero-fab'),
    headerIcon: !!document.querySelector('[data-slot="conversation.session.header.utilities"] .filex-group'),
  })`))

  // 3. click a chat file link → editor modal
  console.log('[3] click file:', await evalJs(`(() => {
    for (const b of document.querySelectorAll('[data-slot="conversation.session"] button')) {
      if ((b.className || '').toString().includes('fileLink')) { b.click(); return 'clicked: ' + (b.textContent || '').trim().slice(0, 50) }
    }
    return 'no fileLink'
  })()`))
  await sleep(5000)
  console.log('[3] editor:', await evalJs(`JSON.stringify({
    modal: !!document.querySelector('.filex-modal'),
    editor: !!document.querySelector('.filex-editor'),
    path: (document.querySelector('.filex-title')?.textContent || '').trim().slice(0, 70),
  })`))
  ws.close()
} finally {
  proc.kill()
}
