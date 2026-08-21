/**
 * What this browser said, before the run says it back.
 *
 * A steer, a stop and an answer are all `1779` control events — the operator's
 * half of a session, sent straight to the agent. They never become a turn of
 * their own: `agent-store.ts`'s `STORED_KINDS` only reads `1777`/`31777`/`31779`,
 * by design, because a control event is an instruction and not part of the
 * record it produces. So the instant after clicking send, the transcript has
 * gone quiet about it — the composer already cleared the text, and nothing
 * will say it happened until the agent turns it into something: a `user` turn
 * echoing a steer, a request leaving the head's `pending` list, a status that
 * has moved off `active`.
 *
 * This is that gap, held in memory. An "intent" is this tab remembering it
 * asked, for exactly as long as it takes a "fact" — a decoded turn or head,
 * read the ordinary way out of Dexie — to catch up to it. `reconcileIntents`
 * is what notices the fact arrived and drops the intent; nothing here ever
 * decides an intent is settled on its own, because only the read side knows
 * what actually landed.
 *
 * Nothing survives a reload, and nothing should: an intent with no fact behind
 * it is a guess about network state this tab no longer remembers making, and a
 * fresh read of the session is the truth regardless.
 */

import type { SessionCommand } from "./agent-control";
import type { DecodedHead, DecodedTurn } from "@/lib/agent-session/types";

export interface SessionIntent {
  id: string;
  command: SessionCommand;
  /** The steer message, or the free-text answer to a request. */
  text?: string;
  /** The option chosen, when `respond` answered a multiple-choice question. */
  option?: string;
  /** Which open request this answers. Only meaningful for `respond`. */
  request?: string;
  /** `Date.now()` when it was sent, for weighing a steer against turns. */
  createdAt: number;
}

type Listener = () => void;

const intents = new Map<string, SessionIntent[]>();
const listeners = new Map<string, Set<Listener>>();

function key(agent: string, session: string): string {
  return `${agent}:${session}`;
}

function ring(k: string): void {
  for (const listener of listeners.get(k) ?? []) listener();
}

let nextId = 0;

/**
 * Record one, right as the send goes out — before the `await`, not after.
 *
 * A caller that failed to send removes it again; one that succeeded leaves it
 * for `reconcileIntents` to clear once the fact arrives. Two intents for the
 * same request can coexist (an answer resent after a failure), which is
 * correct: both were said, and the fact clears both at once.
 */
export function addIntent(
  agent: string,
  session: string,
  intent: Omit<SessionIntent, "id" | "createdAt">,
): string {
  const id = `intent-${Date.now()}-${(nextId += 1)}`;
  const k = key(agent, session);
  intents.set(k, [
    ...(intents.get(k) ?? []),
    { ...intent, id, createdAt: Date.now() },
  ]);
  ring(k);
  return id;
}

/** Drop one — sent and failed, or confirmed by a fact and not worth showing twice. */
export function removeIntent(agent: string, session: string, id: string): void {
  const k = key(agent, session);
  const list = intents.get(k);
  if (!list) return;
  const next = list.filter((intent) => intent.id !== id);
  if (next.length === list.length) return;
  if (next.length > 0) intents.set(k, next);
  else intents.delete(k);
  ring(k);
}

/**
 * The snapshot for a session with nothing pending. One frozen array, not a
 * fresh `[]` per call: `useSessionIntents` feeds this to `useSyncExternalStore`,
 * which re-renders forever if the snapshot's identity changes every read.
 */
export const NO_INTENTS: readonly SessionIntent[] = Object.freeze([]);

export function getIntents(
  agent: string,
  session: string,
): readonly SessionIntent[] {
  return intents.get(key(agent, session)) ?? NO_INTENTS;
}

export function subscribeIntents(
  agent: string,
  session: string,
  listener: Listener,
): () => void {
  const k = key(agent, session);
  const set = listeners.get(k) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(k, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(k);
  };
}

/** The turn's plain text, when it carried one — what a steer's echo is judged against. */
function turnText(turn: DecodedTurn): string | undefined {
  const part = turn.parts.find(
    (candidate): candidate is { type: "text"; text: string } =>
      candidate.type === "text" && typeof candidate.text === "string",
  );
  return part?.text;
}

/**
 * Grace before a `user` turn counts as a steer's echo, in milliseconds.
 *
 * Clocks disagree by a little between the tab that sent this and the machine
 * that turned it into a turn — not by the days a gift wrap's own `created_at`
 * can be off by, since that randomisation is the WRAP's, and a turn's own
 * timestamp is the agent's real clock. A few seconds of slack absorbs the
 * ordinary drift without also matching something said minutes earlier.
 */
const STEER_GRACE_MS = 10_000;

function isSettled(
  intent: SessionIntent,
  facts: {
    status?: DecodedHead["status"];
    pending: string[];
    turns: DecodedTurn[];
  },
): boolean {
  switch (intent.command) {
    case "cancel":
      // The fact a stop produces is the run leaving `active` — there is no
      // resolution part for it, only the status changing under it.
      return facts.status !== undefined && facts.status !== "active";
    case "respond":
      // The fact is the request leaving `pending`. `InputRequestRow` computes
      // the same "settled" from the same list, so the two never disagree.
      return !!intent.request && !facts.pending.includes(intent.request);
    case "steer":
      return facts.turns.some(
        (turn) =>
          turn.role === "user" &&
          turn.created_at * 1000 >= intent.createdAt - STEER_GRACE_MS &&
          turnText(turn) === intent.text,
      );
    default:
      // `start`, `compact`, `clear`, `reset`: no optimistic preview is shown
      // for these, so there is nothing to reconcile.
      return false;
  }
}

/**
 * Drop every intent a fresh read of the session already confirms.
 *
 * Called once per read — the same moment `AgentSessionViewer` re-renders from
 * a new `AgentSessionView` — never on a timer: the read IS the fact, and
 * nothing here should decide an intent is stale on its own.
 */
export function reconcileIntents(
  agent: string,
  session: string,
  facts: {
    status?: DecodedHead["status"];
    pending?: string[];
    turns: DecodedTurn[];
  },
): void {
  const list = getIntents(agent, session);
  if (list.length === 0) return;
  const settled = {
    status: facts.status,
    pending: facts.pending ?? [],
    turns: facts.turns,
  };
  for (const intent of list)
    if (isSettled(intent, settled)) removeIntent(agent, session, intent.id);
}

/** Test seam: forget every intent and listener, so one test cannot leak into the next. */
export function _resetIntentsForTests(): void {
  intents.clear();
  listeners.clear();
}
