/**
 * Vendor the vscode-icons SVG files referenced by vscode-icons-js into
 * src/client/vsi-icons.ts (inlined strings, no runtime network).
 *
 * The vscode-icons-js npm package only ships resolution tables (filename
 * mappings); the actual SVG art lives in the vscode-icons extension repo
 * (vscode-icons-js@11.6.1 embeds data from vscode-icons 11.6.0, so we fetch
 * that tag). Run manually after updating vscode-icons-js:
 *
 *   node scripts/vendor-vsi-icons.mjs
 *
 * Outputs:
 *   src/client/vsi-icons.ts
 *     VSI_ICONS: Record<icon filename, svg markup>
 *     VSI_LIGHT: Record<dark icon filename, light icon filename> (theme swap)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'src', 'client', 'vsi-icons.ts')

// ── 1. collect needed icon filenames ────────────────────────────────────────
const e1 = require('vscode-icons-js/dist/generated/FileExtensions1ToIcon.js').FileExtensions1ToIcon
const e2 = require('vscode-icons-js/dist/generated/FileExtensions2ToIcon.js').FileExtensions2ToIcon
const fnames = require('vscode-icons-js/dist/generated/FileNamesToIcon.js').FileNamesToIcon
const langs = require('vscode-icons-js/dist/generated/LanguagesToIcon.js').LanguagesToIcon
const folders = require('vscode-icons-js/dist/generated/FolderNamesToIcon.js').FolderNamesToIcon

const iconsJson = JSON.parse(readFileSync(join(root, 'node_modules/vscode-icons-js/data/generated/icons.json'), 'utf8'))
const defs = iconsJson.iconDefinitions
const pathOf = (defKey) => (defs[defKey]?.iconPath ?? '').split('/').pop() || undefined

const DEFAULTS = [
  'default_file.svg',
  'default_folder.svg',
  'default_folder_opened.svg',
  'default_root_folder.svg',
  'default_root_folder_opened.svg',
]

const darkFiles = new Set([
  ...Object.values(e1), ...Object.values(e2), ...Object.values(fnames),
  ...Object.values(langs), ...Object.values(folders), ...DEFAULTS,
])
// opened variants for every folder icon
for (const f of Object.values(folders)) darkFiles.add(f.replace('.svg', '_opened.svg'))

// light section → light filenames + dark→light filename map
const light = iconsJson.light ?? {}
const lightFiles = new Set()
const lightMap = new Map() // darkFilename -> lightFilename

function collectLight(sectionKey, darkNameOf) {
  const sec = light[sectionKey]
  if (!sec || typeof sec !== 'object') return
  for (const [name, lightDefKey] of Object.entries(sec)) {
    const lightFile = pathOf(lightDefKey)
    if (!lightFile) continue
    lightFiles.add(lightFile)
    const darkFile = darkNameOf(name)
    if (darkFile) lightMap.set(darkFile, lightFile)
  }
}
collectLight('fileNames', (n) => fnames[n])
collectLight('fileExtensions', (n) => e1[n] ?? e2[n])
collectLight('languageIds', (n) => langs[n])
collectLight('folderNames', (n) => folders[n])
collectLight('folderNamesExpanded', (n) => (folders[n] ? folders[n].replace('.svg', '_opened.svg') : undefined))
for (const [secKey, darkName] of [
  ['file', 'default_file.svg'],
  ['folder', 'default_folder.svg'],
  ['folderExpanded', 'default_folder_opened.svg'],
  ['rootFolder', 'default_root_folder.svg'],
  ['rootFolderExpanded', 'default_root_folder_opened.svg'],
]) {
  const lf = pathOf(light[secKey])
  if (lf) {
    lightFiles.add(lf)
    lightMap.set(darkName, lf)
  }
}
// light opened variants for light folder icons (folder_type_x_light → folder_type_x_light_opened)
for (const lf of [...lightFiles]) {
  if (lf.startsWith('folder_type_') && lf.endsWith('.svg') && !lf.endsWith('_opened.svg')) {
    lightFiles.add(lf.replace('.svg', '_opened.svg'))
  }
}
// drop no-op light entries (same file) and entries whose light file we never fetched
for (const [dark, lightFile] of [...lightMap]) {
  if (dark === lightFile || !lightFiles.has(lightFile)) lightMap.delete(dark)
}

const needed = new Set([...darkFiles, ...lightFiles])
console.log(`needed icons: ${needed.size} (dark ${darkFiles.size} + light-only ${[...lightFiles].filter((f) => !darkFiles.has(f)).length})`)

// ── 2. fetch the vscode-icons repo at the matching tag ──────────────────────
const WORK = join(tmpdir(), 'vsi-vendor')
const CANDIDATE_TAGS = ['v11.6.0', '11.6.0', 'v11.6.1']
let iconsDir
for (const tag of CANDIDATE_TAGS) {
  const tgz = join(WORK, `vscode-icons-${tag}.tar.gz`)
  const dir = join(WORK, `vscode-icons-${tag}`)
  if (!existsSync(dir)) {
    mkdirSync(WORK, { recursive: true })
    console.log(`downloading vscode-icons@${tag} …`)
    try {
      execFileSync('curl', ['-fsSL', '--retry', '2', '-o', tgz, `https://codeload.github.com/vscode-icons/vscode-icons/tar.gz/refs/tags/${tag}`], { stdio: 'inherit' })
      execFileSync('tar', ['-xzf', tgz, '-C', WORK], { stdio: 'inherit' })
      // tar may name the folder vscode-icons-11.6.0
      const extracted = join(WORK, `vscode-icons-${tag.replace(/^v/, '')}`)
      const alt = join(WORK, `vscode-icons-${tag}`)
      const found = existsSync(extracted) ? extracted : existsSync(alt) ? alt : undefined
      if (found) {
        iconsDir = join(found, 'icons')
      }
      if (iconsDir && existsSync(iconsDir)) break
      console.log(`tag ${tag}: icons dir not found, trying next`)
    } catch (err) {
      console.log(`tag ${tag} failed: ${String(err.message ?? err).slice(0, 160)}`)
    }
  } else if (existsSync(join(dir, 'icons'))) {
    iconsDir = join(dir, 'icons')
    break
  }
}
if (!iconsDir || !existsSync(iconsDir)) {
  console.error('could not obtain vscode-icons icons/ directory (need network to codeload.github.com)')
  process.exit(1)
}
console.log(`using icons dir: ${iconsDir}`)

// ── 3. read every needed svg ────────────────────────────────────────────────
const missing = []
const icons = {}
for (const name of needed) {
  const p = join(iconsDir, name)
  if (!existsSync(p)) {
    missing.push(name)
    continue
  }
  const raw = readFileSync(p, 'utf8').trim()
  if (!raw.startsWith('<svg')) {
    missing.push(name + ' (not an svg)')
    continue
  }
  icons[name] = raw
}
if (missing.length > 0) {
  console.warn(`missing ${missing.length} icon files (fall back to defaults at render time):`)
  console.warn(missing.slice(0, 40).join(', '))
}
// drop light-map entries whose file is missing
for (const [dark, lightFile] of [...lightMap]) {
  if (!icons[lightFile]) lightMap.delete(dark)
}

// ── 4. emit src/client/vsi-icons.ts ─────────────────────────────────────────
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

const entries = [...new Set(Object.keys(icons))].sort()
const lines = entries.map((name) => `  ${JSON.stringify(name)}: \`${esc(icons[name])}\`,`)
const lightEntries = [...lightMap.entries()]
  .filter(([d, l]) => d !== l)
  .map(([d, l]) => `  ${JSON.stringify(d)}: ${JSON.stringify(l)},`)

const out = `/**
 * vscode-icons SVG art, generated by scripts/vendor-vsi-icons.mjs — DO NOT EDIT.
 * Source: vscode-icons/vscode-icons@11.6.0 (the release vscode-icons-js embeds).
 * VSI_ICONS  : icon filename → svg markup (16×16 grid, viewBox varies).
 * VSI_LIGHT  : dark filename → light-theme variant filename.
 */
export const VSI_ICONS: Record<string, string> = {
${lines.join('\n')}
}

export const VSI_LIGHT: Record<string, string> = {
${lightEntries.join('\n')}
}
`
writeFileSync(OUT, out, 'utf8')
console.log(`wrote ${OUT} (${entries.length} icons, ${lightEntries.length} light swaps, ${Object.keys(icons).length === entries.length ? 'ok' : 'size mismatch'})`)
rmSync(WORK, { recursive: true, force: true })
