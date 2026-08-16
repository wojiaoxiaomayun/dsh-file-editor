/**
 * Shared composer-draft insertion for file references (used by both the
 * editor context menu and the explorer tree context menu).
 */
import type { Context, FilexConversation } from '../context-types.ts'

/**
 * Append a reference to the current session's composer draft; returns the
 * failure reason on error.
 */
export function appendToDraft(ctx: Context, sessionId: string, text: string): { ok: boolean; reason?: string } {
  try {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return { ok: false, reason: `sessions.scope 返回 undefined（sessionId=${sessionId}）` }
    const conversation = ctx.get('conversation') as FilexConversation | undefined
    if (conversation === undefined) return { ok: false, reason: 'conversation 服务不可用' }
    const input = conversation.input.for(actx)
    const draft = input.state.getSnapshot().draft
    input.setDraft(draft.trim() === '' ? text : `${draft} ${text}`)
    return { ok: true }
  } catch (error) {
    console.warn('[dsh-file-explorer] draft insert failed:', error)
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
