/**
 * Interception of the chat's file-open funnel. The client runtime's
 * `ctx.workspaces.openPath` is the SINGLE door every chat-side file open goes
 * through — ui-conversation resolves the path against the session cwd and
 * calls it for tool-row path links, the produced-files row, and prose file
 * mentions alike. Wrapping that one method reroutes those opens into the
 * file-explorer modal instead of the Host OS — no DSH modification needed.
 *
 * The wrapper is dependency-free by design (no React / ui-primitives), so the
 * takeover logic stays unit-testable and the file remains importable from any
 * client runtime.
 */

/** The one service method the wrapper replaces (mirror of the runtime IWorkspaces). */
export interface OpenPathService {
  openPath(path: string): Promise<void>
}

/** Per-call decisions the wrapper needs (wired to the module store in the client half). */
export interface OpenPathInterceptDeps {
  /** The session whose scope the explorer loads the file in (current session). */
  currentSessionId(): string | undefined
  /**
   * Route the open into the explorer modal. Resolves true when the editor
   * took the open over (the path is readable inside the session cwd); false
   * declines and lets the call fall through to the original method.
   */
  openInEditor(path: string, sessionId: string): Promise<boolean>
}

/**
 * Wrap `workspaces.openPath`: intercepted calls open the file in the explorer
 * modal instead of the Host OS and resolve as success (the original's callers
 * ignore the result); anything that declines falls through to the original
 * method untouched.
 * @param workspaces - the client workspaces service to wrap.
 * @param deps - per-call takeover decisions.
 * @returns the disposer restoring the original method (HMR-safe).
 */
export function wrapOpenPath(workspaces: OpenPathService, deps: OpenPathInterceptDeps): () => void {
  // The RAW method reference (never a bound copy): restore must put back the
  // exact original so a chain of wrappers (other plugins wrapping the same
  // method) keeps working across disposals in any order. The property is
  // redefined (not assigned) so a getter-shaped service face is covered too.
  const descriptor = Object.getOwnPropertyDescriptor(workspaces, 'openPath')
  const original = workspaces.openPath
  const wrapped = async (path: string): Promise<void> => {
    const sessionId = deps.currentSessionId()
    if (sessionId !== undefined) {
      const took = await deps.openInEditor(path, sessionId)
      if (took) return
    }
    return original.call(workspaces, path)
  }
  Object.defineProperty(workspaces, 'openPath', {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    writable: false,
    value: wrapped,
  })
  return () => {
    if (descriptor !== undefined) Object.defineProperty(workspaces, 'openPath', descriptor)
    else {
      delete workspaces.openPath
      workspaces.openPath = original
    }
  }
}

/** The remote session face whose `openWorkspacePath` the wrapper replaces. */
export interface OpenWorkspacePathService {
  openWorkspacePath(input: { path: string }): Promise<{ ok: boolean; value?: { opened: boolean }; error?: { message: string } }>
}

/**
 * Wrap `remote.session.openWorkspacePath` — the chat file-open funnel in
 * current runtimes (ui-chat's `ChatView` calls it for tool-row path links,
 * the produced-files row, and prose file mentions alike). Intercepted opens
 * go to the explorer modal and resolve as a successful open (the caller only
 * checks `ok`); anything that declines falls through to the original RPC,
 * which opens the path with the Host OS default application.
 *
 * The generated remote face exposes `openWorkspacePath` as an own accessor
 * (getter without setter), so a plain assignment silently fails — the
 * property is redefined instead, and the original descriptor is restored on
 * disposal (HMR-safe).
 * @param service - the `remote.session` face to wrap.
 * @param deps - per-call takeover decisions (same as {@link wrapOpenPath}).
 * @returns the disposer restoring the original method (HMR-safe).
 */
export function wrapOpenWorkspacePath(service: OpenWorkspacePathService, deps: OpenPathInterceptDeps): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(service, 'openWorkspacePath')
  const original = service.openWorkspacePath
  const wrapped = async (input: { path: string }): Promise<{ ok: boolean; value?: { opened: boolean }; error?: { message: string } }> => {
    const sessionId = deps.currentSessionId()
    if (sessionId !== undefined) {
      const took = await deps.openInEditor(input.path, sessionId)
      if (took) return { ok: true, value: { opened: true } }
    }
    return original.call(service, input)
  }
  Object.defineProperty(service, 'openWorkspacePath', {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    writable: false,
    value: wrapped,
  })
  return () => {
    if (descriptor !== undefined) Object.defineProperty(service, 'openWorkspacePath', descriptor)
    else {
      delete service.openWorkspacePath
      service.openWorkspacePath = original
    }
  }
}
