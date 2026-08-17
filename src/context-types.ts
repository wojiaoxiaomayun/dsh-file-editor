/**
 * Structural types for the cordis services this plugin consumes, plus the
 * Context augmentation. Mirrors the actual runtime shapes; drift is contained
 * to this file. Client-reachable declaration graph stays free of Node types.
 */
import type { Context } from 'cordis'

/** The request face route handlers see (structural subset of node's IncomingMessage). */
export interface FilexHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

/** The response face route handlers write to (structural subset of ServerResponse). */
export interface FilexHttpResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface FilexWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: FilexHttpRequest, res: FilexHttpResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface FilexWebServer {
  register(route: FilexWebRoute): () => void
}

/** A published session's header slice (authoritative cwd). */
export interface FilexSessionHeader {
  cwd?: string
}

/** The host session store face (`ctx.sessions.get(id)` returns the live session). */
export interface FilexSessionStore {
  get(id: string): { header: FilexSessionHeader } | undefined
  /** Resolve an Agent-scoped context view for one session (client runtime). */
  scope(id: string): unknown | undefined
}

/** Structural face of the framework session-list snapshot (`useSessions` selector input). */
export interface FilexSessionListState {
  /** The currently selected session id; undefined while none is selected / still loading. */
  current?: string
  phase?: string
  byId?: Record<string, { cwd?: string; blank?: boolean }>
}

/**
 * The framework-injected `useSessions` selector hook — a standard prop of
 * root-scoped slots (shell.overlay, sidebar, …). Subscribes to the session
 * list store and re-renders on change.
 */
export type FilexUseSessions = (selector: (state: FilexSessionListState) => unknown) => unknown

/** The composer input face (client conversation service). */
export interface FilexConversationInput {
  state: { getSnapshot(): { draft: string } }
  setDraft(text: string): void
}

/** The conversation service face (client, lazy via ctx.get('conversation')). */
export interface FilexConversation {
  input: { for(actx: unknown): FilexConversationInput }
}

/** The client slots service face (register returns the disposer). */
export interface FilexSlotsService {
  register(options: {
    name: string
    id?: string
    key?: string
    order?: number
    label?: string | (() => string)
    inject?: (...args: unknown[]) => Record<string, unknown>
  }, component: unknown): () => void
  inject(key: string, callback: () => () => void): () => void
}

declare module 'cordis' {
  interface Context {
    webServer: FilexWebServer
    sessions: FilexSessionStore
    slots: FilexSlotsService
    /** Subscribe to session events (cordis event API). */
    on(event: string, listener: (session: unknown, event: unknown) => void): () => void
    /** DSH-vendored cordis lifecycle helper. */
    effect(fn: () => void | (() => void), label?: string): void
  }
}

export type { Context }
