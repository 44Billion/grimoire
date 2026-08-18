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
  KIND_MILESTONE,
  KIND_SESSION_HEAD,
  KIND_TURN,
} from "@/lib/agent-session/kinds";
import { parseAgentEvent } from "@/lib/agent-session/decode";
import { mergeStream, newestHeads } from "@/lib/agent-session/order";
import type {
  AgentSessionEvent,
  DecodedHead,
  DecodedMilestone,
  DecodedTurn,
  Rumor,
} from "@/lib/agent-session/types";

const STORED_KINDS = new Set([KIND_TURN, KIND_MILESTONE, KIND_SESSION_HEAD]);

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
  // Everything from the private mirror arrived wrapped, so its stream is nip17.
  return parseAgentEvent(toRumor(row), { transport: "nip17" });
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

export interface AgentSessionView {
  head: DecodedHead | null;
  turns: DecodedTurn[];
  milestones: DecodedMilestone[];
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
      (event): event is DecodedTurn | DecodedMilestone | DecodedHead =>
        !!event &&
        (event.type === "turn" ||
          event.type === "milestone" ||
          event.type === "head") &&
        event.session.agent === agent &&
        event.session.session === session,
    );

  const heads = events.filter((e): e is DecodedHead => e.type === "head");
  const head = newestHeads(heads)[0] ?? null;

  // A head carries no `seq` — it is replaceable, so a number it consumed would
  // be a hole on any relay that dropped the superseded version. It supplies the
  // ceiling for gap detection and nothing else.
  const sequenced = events.filter(
    (e): e is DecodedTurn | DecodedMilestone => e.type !== "head",
  );
  const [stream] = mergeStream(sequenced, head ? [head] : []);

  return {
    head,
    turns: (stream?.ordered ?? []).filter(
      (e): e is DecodedTurn => e.type === "turn",
    ),
    milestones: (stream?.ordered ?? []).filter(
      (e): e is DecodedMilestone => e.type === "milestone",
    ),
    gaps: stream?.gaps.flatMap((gap) => gap.missing) ?? [],
    forks: stream?.forks.map((fork) => fork.seq) ?? [],
    duplicates: stream?.duplicates.map((duplicate) => duplicate.seq) ?? [],
  };
}
