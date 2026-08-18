/**
 * Typed fetch wrapper over the /filex JSON API + media URL builder.
 */

export class FilexApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface SessionScope {
  sessionId: string
}

export interface FsEntry {
  name: string
  relPath: string
  size: number
}

export interface FsTextResult { kind: 'text'; content: string; size: number; truncated: boolean }
export interface FsBinaryResult { kind: 'binary'; size: number; truncated: boolean }

export interface SearchMatch {
  file: string
  line: number
  text: string
  highlights: Array<{ start: number; end: number }>
}

async function call<T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/filex/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    throw new FilexApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new FilexApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

export const api = {
  sessionCwd: (scope: SessionScope, signal?: AbortSignal) =>
    call<{ sessionId: string; cwd: string; root: string }>('session.cwd', { sessionId: scope.sessionId }, signal),
  fsList: (scope: SessionScope, signal?: AbortSignal) =>
    call<{ root: string; files: FsEntry[]; truncated: boolean }>('fs.list', { sessionId: scope.sessionId }, signal),
  fsRead: (scope: SessionScope, path: string, signal?: AbortSignal) =>
    call<FsTextResult | FsBinaryResult>('fs.read', { sessionId: scope.sessionId, path }, signal),
  fsWrite: (scope: SessionScope, path: string, content: string) =>
    call<{ ok: true }>('fs.write', { sessionId: scope.sessionId, path, content }),
  fsReveal: (scope: SessionScope, cwd?: string, signal?: AbortSignal) =>
    call<{ ok: true; cwd: string }>('fs.reveal', {
      sessionId: scope.sessionId,
      ...(cwd !== undefined && cwd !== '' ? { cwd } : {}),
    }, signal),
  fsVscode: (scope: SessionScope, cwd?: string, signal?: AbortSignal) =>
    call<{ ok: true; cwd: string; cli: string }>('fs.vscode', {
      sessionId: scope.sessionId,
      ...(cwd !== undefined && cwd !== '' ? { cwd } : {}),
    }, signal),
  fsCapabilities: (signal?: AbortSignal) =>
    call<{ vscode: boolean }>('fs.capabilities', {}, signal),
  fsSearch: (scope: SessionScope, pattern: string, options: { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean }, include: string[], exclude: string[], signal?: AbortSignal) =>
    call<{ results: SearchMatch[]; truncated: boolean }>('fs.search', {
      sessionId: scope.sessionId,
      pattern,
      options,
      include,
      exclude,
    }, signal),
}

/** Absolute URL of the media route for one path (images / PDFs). */
export function mediaUrl(scope: SessionScope, path: string): string {
  const params = new URLSearchParams({ sessionId: scope.sessionId, path })
  return `/filex/file?${params.toString()}`
}
