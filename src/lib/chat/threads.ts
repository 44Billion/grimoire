/**
 * Folding replies out of a timeline and into threads.
 *
 * Protocol-blind on purpose. Every adapter has already reduced its own wire
 * format to `Message.replyTo` (the immediate parent) and, where the format says
 * so, `Message.threadRoot` — so a NIP-29 `q` tag, a Concord kind-1111 `E` and a
 * NIP-17 NIP-10 marker all arrive here as the same two fields. Nothing below
 * knows which protocol it is looking at, and adding a protocol needs no change
 * here.
 *
 * Every rule in this file is a rule about a message NOT disappearing. A reply
 * whose ancestry cannot be resolved inside the loaded window stays exactly where
 * it is today, because a flat reply is legible and a missing one is
 * indistinguishable, to the reader, from one nobody sent.
 */

import type { Message } from "@/types/chat";

/** How far a parent chain is followed before it is assumed to be a cycle. */
const MAX_HOPS = 32;

export interface ThreadSummary {
  /** The message the thread hangs under. Always a row still in the timeline. */
  rootId: string;
  /** Replies, oldest first, in the order the timeline handed them over. */
  replyIds: string[];
  /** Distinct reply authors, in first-reply order. */
  repliers: string[];
  /** The newest reply's timestamp. */
  latest: number;
}

export interface FoldedThreads {
  /** The timeline with folded replies removed. Identity-equal when not folding. */
  rows: Message[];
  /** Summaries by root id, for every root that has at least one reply. */
  threads: Map<string, ThreadSummary>;
  /**
   * Reply id → the root row it now lives under.
   *
   * Anything that resolves a message by id against the RENDERED rows needs this,
   * because a folded reply has no row of its own any more. `jumpTo` does — a
   * search hit naming a folded reply would otherwise page history forever
   * looking for a row that will never appear. Empty when nothing was folded.
   */
  replyToRoot: Map<string, string>;
}

export interface FoldThreadsOptions {
  /**
   * The conversation's own root, when the conversation IS a thread.
   *
   * NIP-10, NIP-22 and NIP-53 are whole timelines of replies to one event. A
   * reply to that event is a top-level message there, not a thread — without
   * this the entire timeline collapses into a single hidden thread under its
   * own root.
   */
  conversationRootId?: string;
  /** Whether to actually remove reply rows, or only describe the threads. */
  collapse: boolean;
}

/** A row that can be threaded, either as a root or as a reply. */
function threadable(message: Message): boolean {
  // A system row is collapsed by `groupSystemMessages` and a zap is a payment,
  // not a turn in a conversation. Neither joins a thread, and neither hosts one.
  return message.type === undefined || message.type === "user";
}

export function foldThreads(
  messages: readonly Message[],
  { conversationRootId, collapse }: FoldThreadsOptions,
): FoldedThreads {
  const empty = {
    rows: messages as Message[],
    threads: new Map<string, ThreadSummary>(),
    replyToRoot: new Map<string, string>(),
  };
  if (messages.length === 0) return empty;

  const byId = new Map<string, Message>();
  for (const message of messages) byId.set(message.id, message);

  /**
   * The one message this row's ancestry points at, root first.
   *
   * `threadRoot` when the wire stated it — it survives an intermediate reply
   * never having loaded, which a parent walk cannot. `replyTo` otherwise, which
   * is the NIP-29 `q` case: a parent and nothing else.
   */
  function hop(message: Message): string | undefined {
    if (message.threadRoot) return message.threadRoot;
    return message.replyTo && "id" in message.replyTo
      ? message.replyTo.id
      : undefined;
  }

  /**
   * The row this message's thread hangs under, or undefined if it is not a reply
   * into a thread the timeline can draw.
   *
   * The answer is the NEAREST ancestor that is itself a top-level row — not the
   * deepest root the wire mentions. In a conversation that IS a thread, a comment
   * on the conversation root is top-level, so a reply to that comment belongs to
   * the comment's thread and not to the conversation's.
   *
   * Three things make an ancestor top-level, and all three are answers a row
   * still exists for: it replies to nothing, it replies to the conversation root,
   * or it is itself an orphan — a reply whose own parent is outside the loaded
   * window, which rule 3 keeps on screen.
   *
   * Undefined means the chain leaves the window, hits a cycle, or runs through
   * something unthreadable. Every one of those leaves this message as an
   * ordinary row.
   */
  const roots = new Map<string, string | undefined>();
  function rootOf(message: Message): string | undefined {
    const memo = roots.get(message.id);
    if (memo !== undefined || roots.has(message.id)) return memo;

    const seen = new Set<string>([message.id]);
    let candidate = hop(message);
    let resolved: string | undefined;

    for (let hops = 0; hops < MAX_HOPS; hops++) {
      if (!candidate) break;
      if (candidate === conversationRootId) break;
      // Already on the path: a malformed cycle. Nothing here can be a root.
      if (seen.has(candidate)) break;
      const node = byId.get(candidate);
      if (!node || !threadable(node)) break;
      seen.add(candidate);

      const next = hop(node);
      // A cycle, one step further on. Neither end of it may host the other's
      // thread — that would fold both away and leave no row to open.
      if (next && seen.has(next)) break;

      const above = next ? byId.get(next) : undefined;
      const nodeIsTopLevel =
        !next || next === conversationRootId || !above || !threadable(above);
      if (nodeIsTopLevel) {
        resolved = candidate;
        break;
      }
      candidate = next;
    }

    roots.set(message.id, resolved);
    return resolved;
  }

  const threads = new Map<string, ThreadSummary>();
  const replyToRoot = new Map<string, string>();

  for (const message of messages) {
    if (!threadable(message)) continue;
    if (!message.replyTo && !message.threadRoot) continue;
    const rootId = rootOf(message);
    if (!rootId) continue;

    replyToRoot.set(message.id, rootId);
    const summary = threads.get(rootId);
    if (summary) {
      summary.replyIds.push(message.id);
      if (!summary.repliers.includes(message.author))
        summary.repliers.push(message.author);
      summary.latest = Math.max(summary.latest, message.timestamp);
    } else {
      threads.set(rootId, {
        rootId,
        replyIds: [message.id],
        repliers: [message.author],
        latest: message.timestamp,
      });
    }
  }

  // Expanded mode still reports the threads — the parent shows a reply count and
  // the pane still opens — but the rows are handed back by IDENTITY, so the
  // caller's memo and the Virtuoso prepend anchor see no change at all.
  if (!collapse) return { ...empty, threads };
  if (replyToRoot.size === 0) return { ...empty, threads };

  return {
    rows: messages.filter((message) => !replyToRoot.has(message.id)),
    threads,
    replyToRoot,
  };
}

/**
 * How many replies in each thread the reader has not seen.
 *
 * Separate from `foldThreads` because folding is structure and this is reading
 * state: the divider's stamp cannot be captured until the rows it will be placed
 * over exist, so the two cannot be one pass without the fold depending on a
 * value that depends on the fold.
 *
 * Same rule as `findDividerId`: strictly after the stamp, and never the reader's
 * own message. A `lastRead` of 0 means the conversation has never been opened,
 * and counts nothing at all — flagging the whole history of a channel someone
 * just joined is noise, which is the rule the divider already follows.
 */
export function countThreadUnread(
  threads: ReadonlyMap<string, ThreadSummary>,
  messages: readonly Message[],
  lastRead: number,
  selfPubkey?: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (lastRead <= 0 || threads.size === 0) return counts;

  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const [rootId, thread] of threads) {
    let unread = 0;
    for (const replyId of thread.replyIds) {
      const reply = byId.get(replyId);
      if (!reply || reply.timestamp <= lastRead) continue;
      if (selfPubkey && reply.author === selfPubkey) continue;
      unread++;
    }
    if (unread > 0) counts.set(rootId, unread);
  }
  return counts;
}
