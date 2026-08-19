import db, { type AiConversation } from "./db";
import eventStore from "./event-store";

/**
 * AI conversation persistence, keyed by window id.
 *
 * Windows are restored from localStorage on load, so without this a reload
 * leaves an empty pane where a conversation was. Deliberately dumb: no history
 * list, no search, no cross-window sharing — a window remembers its own turns.
 */

export type AiTurns = AiConversation["turns"];
export type AiConversationTarget = AiConversation["target"];

export async function loadConversation(windowId: string): Promise<AiTurns> {
  return (await loadStoredConversation(windowId)).turns;
}

/**
 * The stored row: its turns and what they are about.
 *
 * Both together, because a window restored from the index knows only its id —
 * the subject has to come back with the turns or the conversation reopens
 * talking about nothing.
 */
export async function loadStoredConversation(
  windowId: string,
): Promise<{ turns: AiTurns; target?: AiConversationTarget }> {
  try {
    const row = await db.aiConversations.get(windowId);
    if (row) hydrateMentions(row.turns);
    return {
      turns: row?.turns ?? [],
      ...(row?.target ? { target: row.target } : {}),
    };
  } catch {
    // A conversation is a convenience, never a blocker. An unreadable row
    // should leave an empty window, not a broken one.
    return { turns: [] };
  }
}

/**
 * Put a conversation's referenced events back in the EventStore.
 *
 * Everything that renders a `nostr:` reference reads the store, so a reopened
 * transcript shows names and embedded notes instead of stubs — without a relay
 * round trip for objects the conversation already carried. The store dedupes and
 * handles replaceables, so re-adding a stale kind 0 is harmless.
 */
function hydrateMentions(turns: AiTurns): void {
  for (const turn of turns) {
    for (const event of turn.mentions?.events ?? []) {
      try {
        eventStore.add(event);
      } catch {
        // A malformed stored event is not worth failing the load over.
      }
    }
  }
}

export interface ConversationSummary {
  windowId: string;
  /** First thing the user asked, which is what they will recognise it by. */
  title: string;
  turnCount: number;
  updatedAt: number;
}

/**
 * Every stored conversation, newest first. Titles come from the first user
 * turn — a conversation is remembered by its question, not by an id.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  try {
    const rows = await db.aiConversations
      .orderBy("updatedAt")
      .reverse()
      .toArray();
    for (const row of rows) hydrateMentions(row.turns);
    return rows.map((row) => ({
      windowId: row.windowId,
      title:
        row.turns.find((turn) => turn.role === "user")?.content.trim() ||
        "(no question)",
      turnCount: row.turns.length,
      updatedAt: row.updatedAt,
    }));
  } catch {
    return [];
  }
}

/**
 * Turns to write, given what is already stored.
 *
 * A window builds its next state from the turns it has in memory, and those come
 * from a live query that may not have resolved yet. A conversation reopened by id
 * and answered immediately therefore arrived here as two turns to write over
 * twenty — and the twenty were gone.
 *
 * The caller-side race is fixed (the sender re-reads the row), but this is the
 * function that destroys history, so it checks: a shorter list that does not
 * begin where the stored one begins is not a newer version of the conversation,
 * it is a fresh one built on nothing. Keep both, in order.
 */
export function reconcileTurns(stored: AiTurns | undefined, next: AiTurns) {
  if (!stored || stored.length === 0) return next;
  if (next.length >= stored.length) return next;

  const sameStart =
    stored[0].role === next[0].role && stored[0].content === next[0].content;
  return sameStart ? next : [...stored, ...next];
}

export async function saveConversation(
  windowId: string,
  turns: AiTurns,
  target?: AiConversationTarget,
): Promise<void> {
  try {
    if (turns.length === 0) {
      await db.aiConversations.delete(windowId);
      return;
    }
    const existing = await db.aiConversations.get(windowId);
    await db.aiConversations.put({
      windowId,
      turns: reconcileTurns(existing?.turns, turns),
      // A conversation that already knew its subject keeps it: reopening by id
      // passes no target, and the window should not forget what it is about.
      ...((target ?? existing?.target)
        ? { target: target ?? existing?.target }
        : {}),
      updatedAt: Date.now(),
    });
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
