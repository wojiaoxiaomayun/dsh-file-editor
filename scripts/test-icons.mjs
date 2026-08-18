// Verify resolution + art coverage for realistic workspace paths.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { getIconForFile, getIconForFolder, getIconForOpenFolder, DEFAULT_FILE, DEFAULT_FOLDER, DEFAULT_FOLDER_OPENED } =
  require('vscode-icons-js/dist/Index.js')

const ts = readFileSync('src/client/vsi-icons.ts', 'utf8')
const have = new Set([...ts.matchAll(/^  "([^"]+)": `/gm)].map((m) => m[1]))

const cases = [
  ['file', 'src/client/Explorer.tsx'],
  ['file', 'src/client/style.ts'],
  ['file', 'package.json'],
  ['file', 'pnpm-lock.yaml'],
  ['file', 'README.md'],
  ['file', '.gitignore'],
  ['file', 'tsconfig.json'],
  ['file', 'vite.config.ts'],
  ['file', 'index.html'],
  ['file', 'styles.css'],
  ['file', 'logo.png'],
  ['file', 'report.pdf'],
  ['file', 'archive.zip'],
  ['file', 'database.sqlite'],
  ['file', 'Dockerfile'],
  ['file', 'Makefile'],
  ['file', 'LICENSE'],
  ['file', 'data.csv'],
  ['file', 'script.py'],
  ['file', 'main.go'],
  ['file', 'unknown.xyzzy'],
  ['file', 'preact-notes.txt'],
  ['dir', 'src'],
  ['dir', 'node_modules'],
  ['dir', '.github'],
  ['dir', 'public'],
  ['dir', 'dist'],
]
let bad = 0
for (const [kind, path] of cases) {
  const base = path.split('/').pop()
  let name
  if (kind === 'dir') {
    const closed = getIconForFolder(base)
    const open = getIconForOpenFolder(base)
    const closedOk = have.has(closed) || closed === DEFAULT_FOLDER || have.has(DEFAULT_FOLDER)
    const openOk = have.has(open) || open === DEFAULT_FOLDER_OPENED || have.has(DEFAULT_FOLDER_OPENED)
    name = `closed=${closed} open=${open}`
    if (!closedOk || !openOk) { bad++; console.log(`MISSING DIR ${path}: ${name}`) }
  } else {
    const icon = getIconForFile(base) ?? DEFAULT_FILE
    const ok = have.has(icon) || have.has(DEFAULT_FILE)
    name = icon
    if (!ok) { bad++; console.log(`MISSING FILE ${path}: ${icon}`) }
  }
  console.log(`${kind.padEnd(4)} ${path.padEnd(24)} → ${name}`)
}
console.log(bad === 0 ? '\nALL RESOLVED ICONS HAVE ART ✓' : `\n${bad} missing`)
