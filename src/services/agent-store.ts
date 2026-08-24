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
 * A session can also arrive the other way: an agent working in a Concord
 * channel carries its transcript on that channel's stream, sealed under the key
 * every member already holds. Those rumors land in `concordRumors` through the
 * wire, not in `dmRumors`, and reading only the inbox meant a run the whole room
 * could decrypt was visible to nobody — the channel showed a pointer to a
 * session the viewer had every key for and no query that would find it. So both
 * stores are read, and a rumor is a rumor once it is out of its envelope.
 *
 * Tag filtering happens in JS. A session is a few hundred events; a compound
 * index for it would be a schema change to save a scan that costs nothing.
 */

import Dexie from "dexie";

import db, { type DmRumorRow, type ConcordRumorRow } from "./db";
import { onDmScopes } from "./dm-bus";
import { onWireScopes } from "@/lib/concord/wire-bus";
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

function toRumor(row: DmRumorRow | ConcordRumorRow): Rumor {
  return {
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.created_at,
    kind: row.kind,
    tags: row.tags,
    content: row.content,
  };
}

function decode(rumor: Rumor): AgentSessionEvent | null {
  return parseAgentEvent(rumor);
}

/**
 * The same events off the Concord side, one community at a time.
 *
 * `communityId` is in every index of that store and MUST be in every query — it
 * is what keeps one community's traffic out of another's — so this walks the
 * viewer's communities rather than reaching for a bare `kind` index that does
 * not exist and should not.
 *
 * Deduped against the inbox by rumor id at the caller: a member who is also a
 * transcript recipient holds the same event twice, and the two copies ARE one
 * event — the agent binds its rumor before wrapping precisely so the ids match.
 * Counting it twice would report a fork at every `seq`.
 */
async function scanConcord(
  viewer: string,
  kinds: Set<number>,
): Promise<ConcordRumorRow[]> {
  const communities = await db.concordCommunities
    .where("pubkey")
    .equals(viewer)
    .toArray();
  if (communities.length === 0) return [];
  const wanted = [...kinds];
  const rows = await db.concordRumors
    .where("[communityId+kind]")
    .anyOf(
      communities.flatMap((community) =>
        wanted.map((kind) => [community.idHex, kind] as [string, number]),
      ),
    )
    .toArray();
  return rows;
}

async function scan(viewer: string, kinds: Set<number>): Promise<Rumor[]> {
  const [inbox, channels] = await Promise.all([
    db.dmRumors
      .where("[viewer+created_at]")
      .between([viewer, Dexie.minKey], [viewer, Dexie.maxKey])
      .toArray(),
    scanConcord(viewer, kinds),
  ]);

  const byId = new Map<string, Rumor>();
  for (const row of inbox)
    if (kinds.has(row.kind)) byId.set(row.id, toRumor(row));
  for (const row of channels) byId.set(row.id, toRumor(row));
  return [...byId.values()];
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

/**
 * The newest head for one session, as the rumor itself.
 *
 * For the `naddr` an agent posts into a room. That pointer names a replaceable
 * event, and the reflex is to hand it to the relay loader — but the only copies
 * of this one are local: sealed to a channel, or gift-wrapped to this viewer.
 * Neither is on a relay in a form anything can query, so the pointer opened
 * nothing while the run sat in a store two panes away. Local first, and the
 * caller falls back to the network for the ordinary case where a session really
 * was published in the open.
 *
 * Newest wins: a head is replaceable, so a run that published six of them has
 * six rows here.
 */
export async function readSessionHeadRumor(
  viewer: string,
  agent: string,
  session: string,
): Promise<Rumor | null> {
  const rows = await scan(viewer, new Set([KIND_SESSION_HEAD]));
  const byId = new Map(rows.map((rumor) => [rumor.id, rumor]));
  const heads = rows
    .map(decode)
    .filter(
      (event): event is DecodedHead =>
        event?.type === "head" &&
        event.session.agent === agent &&
        event.session.session === session,
    );
  const newest = newestHeads(heads)[0];
  return newest ? (byId.get(newest.id) ?? null) : null;
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
/**
 * A run under the message that started it.
 *
 * A `contextWindow` used to ride along, read off the run's definition snapshot,
 * so the row could gauge how full the model's window was. It divided
 * `head.usage.input` — the session's RUNNING total — by that window, so a
 * five-turn run read as overflowing a window it never came close to filling.
 * The honest figure is the latest turn's own usage, which only the session
 * viewer holds; this row holds heads. See `AgentSessionHeadBody`'s `turns`.
 */
export interface SessionForEvent {
  head: DecodedHead;
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
  return found.map((head) => ({ head }));
}

/**
 * The doorbell for everything above, both stores at once.
 *
 * There are two buses because there are two ingests, and a view that listened
 * to only one re-read on half the writes: a session carried on a Concord
 * channel rings the wire bus and nothing else, so the pane sat on a stale read
 * until an unrelated DM happened to arrive. Which bus rang is not a question
 * any caller here can answer anything with — every read in this module is a
 * full re-scan — so the two are folded into one subscription.
 */
export function onAgentEvents(listener: () => void): () => void {
  const offDm = onDmScopes(() => listener());
  const offWire = onWireScopes(() => listener());
  return () => {
    offDm();
    offWire();
  };
}
