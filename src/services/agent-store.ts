/**
 * Reading agent sessions back out of the local mirror.
 *
 * Agent turns arrive the way every other gift wrap does — through
 * `dm-inbox.ts`, into `dmRumors` — so they inherit wrap dedupe, waved
 * decryption, backfill paging and the doorbell for nothing. What they do NOT
 * inherit is a place in the DM UI: `dm-store.ts` accepts their kinds but keeps
 * them out of `DM_ROW_KINDS`, so no agent event can appear in, bump, or badge a
 * conversation. This module is the other end of that arrangement.
 *
 * Tag filtering happens in JS. A session is a few hundred events; a compound
 * index for it would be a schema change to save a scan that costs nothing.
 */

import Dexie from "dexie";

import db, { type DmRumorRow } from "./db";
import {
  KIND_AGENT_DEFINITION,
  KIND_SESSION_HEAD,
  KIND_TURN,
} from "@/lib/agent-session/kinds";
import { parseAgentEvent } from "@/lib/agent-session/decode";
import { mergeStream, newestHeads } from "@/lib/agent-session/order";
import type {
  AgentSessionEvent,
  DecodedDefinition,
  DecodedRepository,
  DecodedHead,
  DecodedTurn,
  Rumor,
} from "@/lib/agent-session/types";

const STORED_KINDS = new Set([
  KIND_TURN,
  KIND_SESSION_HEAD,
  KIND_AGENT_DEFINITION,
]);

function toRumor(row: DmRumorRow): Rumor {
  return {
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.created_at,
    kind: row.kind,
    tags: row.tags,
    content: row.content,
  };
}

function decode(row: DmRumorRow): AgentSessionEvent | null {
  return parseAgentEvent(toRumor(row));
}

async function scan(viewer: string, kinds: Set<number>): Promise<DmRumorRow[]> {
  const rows = await db.dmRumors
    .where("[viewer+created_at]")
    .between([viewer, Dexie.minKey], [viewer, Dexie.maxKey])
    .toArray();
  return rows.filter((row) => kinds.has(row.kind));
}

/** Every session this account can see, newest head per session, newest first. */
export async function listAgentSessions(
  viewer: string,
): Promise<DecodedHead[]> {
  const rows = await scan(viewer, new Set([KIND_SESSION_HEAD]));
  const heads = rows
    .map(decode)
    .filter((event): event is DecodedHead => event?.type === "head");
  return newestHeads(heads).sort((a, b) => b.created_at - a.created_at);
}

/**
 * Every repository the agents you hold definitions for say they have.
 *
 * Read from the definitions the DM pipeline already delivered, like everything
 * else here — a window that reached for a relay would be the only part of this
 * viewer that stops working offline.
 *
 * Newest definition per agent wins. An agent republishes its definition when
 * its checkouts change, and offering a repository it removed is offering a run
 * that will start in a directory that is not there.
 */
export async function listAgentRepositories(
  viewer: string,
): Promise<{ agent: string; repository: DecodedRepository }[]> {
  const rows = await scan(viewer, new Set([KIND_AGENT_DEFINITION]));
  const newest = new Map<string, DecodedDefinition>();

  for (const event of rows.map(decode)) {
    if (event?.type !== "definition") continue;
    const held = newest.get(event.pubkey);
    if (!held || event.created_at > held.created_at)
      newest.set(event.pubkey, event);
  }

  const out: { agent: string; repository: DecodedRepository }[] = [];
  for (const [agent, definition] of newest)
    for (const repository of definition.repositories)
      out.push({ agent, repository });
  return out;
}

export interface AgentSessionView {
  head: DecodedHead | null;
  turns: DecodedTurn[];
  /**
   * How this run was set up — the prompt and the tools it had.
   *
   * Found by following the head's `agent` address, which names either a snapshot
   * of this session or the agent's standing definition. Null when the agent
   * published neither, which is most agents.
   */
  definition: DecodedDefinition | null;
  /** Sequence numbers the stream is missing below the head's `last-seq`. */
  gaps: number[];
  /** Sequence numbers where `prev` disagrees with what we hold. */
  forks: number[];
  /** Sequence numbers held twice — a replayed or forged event. */
  duplicates: number[];
}

/** One session, ordered by the rules in `order.ts` — never by the wrap's clock. */
export async function readAgentSession(
  viewer: string,
  agent: string,
  session: string,
): Promise<AgentSessionView> {
  const rows = await scan(viewer, STORED_KINDS);

  const events = rows
    .map(decode)
    .filter(
      (event): event is DecodedTurn | DecodedHead =>
        !!event &&
        (event.type === "turn" || event.type === "head") &&
        event.session.agent === agent &&
        event.session.session === session,
    );

  const heads = events.filter((e): e is DecodedHead => e.type === "head");
  const head = newestHeads(heads)[0] ?? null;

  /**
   * The definition the head points at, if we hold it.
   *
   * Matched on the address rather than fetched: everything here is a Dexie read
   * over what the DM pipeline already delivered, and a window that reached for a
   * relay would be the only part of this viewer that stops working offline.
   */
  const definition = head?.definition
    ? (rows
        .map(decode)
        .filter(
          (event): event is DecodedDefinition => event?.type === "definition",
        )
        .filter(
          (event) =>
            `${KIND_AGENT_DEFINITION}:${event.pubkey}:${event.slug}` ===
            head.definition,
        )
        .sort((a, b) => b.created_at - a.created_at)[0] ?? null)
    : null;

  // A head carries no `seq` — it is replaceable, so a number it consumed would
  // be a hole on any relay that dropped the superseded version. It supplies the
  // ceiling for gap detection and nothing else.
  const sequenced = events.filter((e): e is DecodedTurn => e.type === "turn");
  const [stream] = mergeStream(sequenced, head ? [head] : []);

  return {
    head,
    definition,
    turns: stream?.ordered ?? [],
    gaps: stream?.gaps.flatMap((gap) => gap.missing) ?? [],
    forks: stream?.forks.map((fork) => fork.seq) ?? [],
    duplicates: stream?.duplicates.map((duplicate) => duplicate.seq) ?? [],
  };
}

/**
 * The sessions a message set running.
 *
 * A head names its trigger — the event that caused the run — so this is the
 * question a conversation asks: what did this message start? The link runs from
 * the session to the message rather than the other way round, which is what lets
 * a client show the runs under a message without the agent having to reply at all.
 *
 * Newest head per session, so a run that has published six heads appears once,
 * in whatever state it last reported.
 */
/** A run under the message that started it, with what it takes to size it. */
export interface SessionForEvent {
  head: DecodedHead;
  /** From the run's own definition snapshot; absent when we do not hold one. */
  contextWindow?: number;
}

export async function listSessionsForEvent(
  viewer: string,
  eventId: string,
): Promise<SessionForEvent[]> {
  const rows = await scan(viewer, new Set([KIND_SESSION_HEAD]));
  const heads = rows
    .map(decode)
    .filter(
      (event): event is DecodedHead =>
        event?.type === "head" && event.trigger?.id === eventId,
    );
  const found = newestHeads(heads).sort((a, b) => a.started - b.started);
  if (found.length === 0) return [];

  /**
   * The window the run had, which only its definition knows.
   *
   * Read AFTER the heads and only when there were any: this runs once per
   * message in a conversation, and almost every message started nothing. A
   * second scan on all of them would double the cost of rendering a chat log to
   * answer a question about a row that is not there.
   */
  const definitions = (await scan(viewer, new Set([KIND_AGENT_DEFINITION])))
    .map(decode)
    .filter((event): event is DecodedDefinition => event?.type === "definition")
    .sort((a, b) => b.created_at - a.created_at);
  const windowFor = (head: DecodedHead) =>
    head.definition
      ? definitions.find(
          (definition) =>
            `${KIND_AGENT_DEFINITION}:${definition.pubkey}:${definition.slug}` ===
            head.definition,
        )?.model?.contextWindow
      : undefined;

  return found.map((head) => ({ head, contextWindow: windowFor(head) }));
}
