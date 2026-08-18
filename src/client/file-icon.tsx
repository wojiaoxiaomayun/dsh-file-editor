/**
 * File / folder icons for the explorer list, straight from the vscode-icons
 * set. Icon resolution (extension / filename / folder-name → icon) comes from
 * `vscode-icons-js` (the same tables the vscode-icons extension uses); the
 * actual SVG art is vendored into `./vsi-icons.ts` by
 * `scripts/vendor-vsi-icons.mjs` so the plugin stays fully offline.
 *
 * Renders the raw SVG markup through a sized wrapper (the art uses a 32×32
 * grid in a varying viewBox); `light` swaps in the theme variants the
 * extension defines for light backgrounds.
 */
import type { JSX } from 'react'
import {
  DEFAULT_FILE,
  DEFAULT_FOLDER,
  DEFAULT_FOLDER_OPENED,
  getIconForFile,
  getIconForFolder,
  getIconForOpenFolder,
} from 'vscode-icons-js'
import { VSI_ICONS, VSI_LIGHT } from './vsi-icons.ts'

export interface FileIconProps {
  /** File relPath; the basename feeds the resolver. */
  path?: string
  /** Explicit name override (folder nodes pass the folder name). */
  name?: string
  kind: 'file' | 'dir'
  /** Render the folder's "opened" variant. */
  open?: boolean
  /** Light theme: use the extension's light-theme art variants. */
  light?: boolean
  size?: number
  className?: string
}

export function FileIcon(props: FileIconProps): JSX.Element {
  const { path, name, kind, open = false, light = false, size = 16, className } = props
  const base = name ?? path?.split('/').pop() ?? ''
  let file: string
  if (kind === 'dir') file = open ? getIconForOpenFolder(base) : getIconForFolder(base)
  else file = getIconForFile(base) ?? DEFAULT_FILE
  if (light) file = VSI_LIGHT[file] ?? file

  const fallback = kind === 'dir'
    ? (open ? DEFAULT_FOLDER_OPENED : DEFAULT_FOLDER)
    : DEFAULT_FILE
  const svg = VSI_ICONS[file] ?? VSI_ICONS[fallback]

  if (svg === undefined) {
    return <span className={className} style={{ width: size, height: size }} aria-hidden />
  }
  return (
    <span
      className={className !== undefined ? `filex-vsi ${className}` : 'filex-vsi'}
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
