import db, { type AiConversation } from "./db";

/**
 * AI conversation persistence, keyed by window id.
 *
 * Windows are restored from localStorage on load, so without this a reload
 * leaves an empty pane where a conversation was. Deliberately dumb: no history
 * list, no search, no cross-window sharing — a window remembers its own turns.
 */

export type AiTurns = AiConversation["turns"];

export async function loadConversation(windowId: string): Promise<AiTurns> {
  try {
    const row = await db.aiConversations.get(windowId);
    return row?.turns ?? [];
  } catch {
    // A conversation is a convenience, never a blocker. An unreadable row
    // should leave an empty window, not a broken one.
    return [];
  }
}

export async function saveConversation(
  windowId: string,
  turns: AiTurns,
): Promise<void> {
  try {
    if (turns.length === 0) {
      await db.aiConversations.delete(windowId);
      return;
    }
    await db.aiConversations.put({ windowId, turns, updatedAt: Date.now() });
  } catch {
    // Quota or a private-mode block: losing history beats losing the reply.
  }
}

export async function deleteConversation(windowId: string): Promise<void> {
  try {
    await db.aiConversations.delete(windowId);
  } catch {
    // Nothing to do — the row is either gone or unreachable.
  }
}
