/**
 * Ordering a session's stored events (NIP-xx: Agent Sessions).
 *
 * NIP-59 randomises a gift wrap's `created_at` up to two days back and a seal's
 * up to an hour, so neither is ever an ordering key. Only the rumor's own
 * `created_at` is the agent's clock, and it is unsigned — a hint, not a proof.
 * Order therefore rests on `seq`, which lives inside the sealed payload.
 */

import { MAX_COUNTER } from "./decode";
import type {
  DecodedHead,
  DecodedMilestone,
  DecodedTurn,
  Transport,
} from "./types";

/**
 * What carries `seq`: turns and milestones, and nothing else.
 *
 * Deltas evaporate at the relay and the head is replaced on it, so neither may
 * consume a sequence number — a number whose event the protocol itself removes
 * is a hole no reader can ever fill.
 */
export type SequencedEvent = DecodedTurn | DecodedMilestone;

/** A `seq` space. Two transports are two streams even for one session. */
export interface StreamKey {
  address: string;
  transport: Transport | "unknown";
}

export interface Gap {
  stream: StreamKey;
  /** Missing sequence numbers, ascending. */
  missing: number[];
  /** Set when the list was cut short; the stream is missing more than it says. */
  truncated?: boolean;
}

export interface Fork {
  stream: StreamKey;
  seq: number;
  /** What the event at `seq` says its predecessor was. */
  claimedPrev: string;
  /** The id actually held at `seq - 1`. */
  heldPrev: string;
}

export interface Duplicate {
  stream: StreamKey;
  seq: number;
  ids: string[];
}

export interface MergedStream {
  stream: StreamKey;
  ordered: SequencedEvent[];
  gaps: Gap[];
  forks: Fork[];
  duplicates: Duplicate[];
}

/**
 * How many missing sequence numbers are worth naming. A reader who is told
 * about the first thousand holes knows everything they can act on, and the
 * ceiling comes from an attacker-supplied tag.
 */
const MAX_REPORTED_GAPS = 1000;

function keyOf(event: SequencedEvent): string {
  return `${event.session.agent}:${event.session.session}|${event.transport ?? "unknown"}`;
}

/**
 * Sort key. `seq` first; then the rumor's own clock and its `ms` refinement;
 * then the id, so two devices holding the same events agree on the order even
 * when a publisher has misbehaved.
 */
function compare(a: SequencedEvent, b: SequencedEvent): number {
  if (a.seq !== b.seq) return a.seq - b.seq;
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  const aMs = a.ms ?? 0;
  const bMs = b.ms ?? 0;
  if (aMs !== bMs) return aMs - bMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Group by stream, order, and report what is wrong: gaps against the head's
 * `last-seq`, forks where `prev` does not name the event actually held at
 * `seq - 1`, and duplicate sequence numbers — the visible signature of a
 * replayed or forged event.
 *
 * `heads` are consulted for the ceiling only. Their `last-seq` is a tag anyone
 * can write, so it is clamped: a hostile head must not turn gap detection into
 * an allocation.
 */
export function mergeStream(
  events: SequencedEvent[],
  heads: DecodedHead[] = [],
): MergedStream[] {
  const byStream = new Map<string, SequencedEvent[]>();
  for (const event of events) {
    const key = keyOf(event);
    const bucket = byStream.get(key);
    if (bucket) bucket.push(event);
    else byStream.set(key, [event]);
  }

  const merged: MergedStream[] = [];

  for (const bucket of byStream.values()) {
    const first = bucket[0]!;
    const stream: StreamKey = {
      address: `${first.session.agent}:${first.session.session}`,
      transport: first.transport ?? "unknown",
    };

    // Deduplicate by event id before anything else: the same event can arrive
    // from several relays, and that is not a duplicate `seq`.
    const unique = new Map<string, SequencedEvent>();
    for (const event of bucket)
      if (!unique.has(event.id)) unique.set(event.id, event);
    const ordered = [...unique.values()].sort(compare);

    const bySeq = new Map<number, SequencedEvent[]>();
    for (const event of ordered) {
      const at = bySeq.get(event.seq);
      if (at) at.push(event);
      else bySeq.set(event.seq, [event]);
    }

    const duplicates: Duplicate[] = [];
    for (const [seq, at] of bySeq)
      if (at.length > 1)
        duplicates.push({ stream, seq, ids: at.map((event) => event.id) });

    const forks: Fork[] = [];
    for (const event of ordered) {
      if (event.seq <= 1) continue;
      if (!event.prev) continue;
      const held = bySeq.get(event.seq - 1);
      if (!held) continue; // a gap, not a fork — reported below
      if (!held.some((candidate) => candidate.id === event.prev))
        forks.push({
          stream,
          seq: event.seq,
          claimedPrev: event.prev,
          heldPrev: held[0]!.id,
        });
    }

    const head = heads.find(
      (candidate) =>
        candidate.session.agent === first.session.agent &&
        candidate.session.session === first.session.session,
    );
    const highest = ordered.reduce((max, event) => Math.max(max, event.seq), 0);
    const claimed = Math.min(head?.lastSeq ?? 0, MAX_COUNTER);
    const ceiling = Math.max(claimed, highest);

    const missing: number[] = [];
    let truncated = false;
    for (let seq = 1; seq <= ceiling; seq += 1) {
      if (bySeq.has(seq)) continue;
      if (missing.length >= MAX_REPORTED_GAPS) {
        truncated = true;
        break;
      }
      missing.push(seq);
    }

    merged.push({
      stream,
      ordered,
      gaps: missing.length
        ? [{ stream, missing, ...(truncated ? { truncated } : {}) }]
        : [],
      forks,
      duplicates,
    });
  }

  return merged;
}

/**
 * Fold heads to the newest per `(pubkey, d)`. On a private stream the head is a
 * rumor inside a wrap, so no relay can replace it and a long session accumulates
 * one row per republish.
 */
export function newestHeads(heads: DecodedHead[]): DecodedHead[] {
  const newest = new Map<string, DecodedHead>();
  for (const head of heads) {
    const key = `${head.pubkey}:${head.session.session}`;
    const held = newest.get(key);
    if (!held || head.created_at > held.created_at) newest.set(key, head);
  }
  return [...newest.values()];
}
