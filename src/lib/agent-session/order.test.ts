import { describe, expect, it } from "vitest";

import { buildTurn, buildSessionHead } from "./encode";
import { parseAgentEvent } from "./decode";
import { mergeStream, newestHeads, type SequencedEvent } from "./order";
import type { DecodedHead, DecodedTurn, SessionRef } from "./types";

const AGENT = "9".repeat(64);
const OPERATOR = "1".repeat(64);
const SESSION =
  "3a7c1f9e0b5d4a2c8e6f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f";
const ref: SessionRef = { agent: AGENT, session: SESSION };

function turn(seq: number, prev: string | undefined, createdAt: number) {
  const rumor = buildTurn(
    AGENT,
    ref,
    {
      role: "assistant",
      parts: [{ type: "text", text: `turn ${seq}` }],
      turn: seq,
      createdAt,
    },
    { seq, prev },
    { pubkey: OPERATOR },
  );
  const decoded = parseAgentEvent(rumor);
  expect(decoded?.type).toBe("turn");
  return decoded as DecodedTurn;
}

/** Build a contiguous chain, each turn naming the previous one. */
function chain(count: number, createdAt: (seq: number) => number) {
  const events: DecodedTurn[] = [];
  let prev: string | undefined;
  for (let seq = 1; seq <= count; seq += 1) {
    const event = turn(seq, prev, createdAt(seq));
    prev = event.id;
    events.push(event);
  }
  return events;
}

describe("mergeStream", () => {
  it("orders by seq even when timestamps are randomised two days back", () => {
    // What a relay would hand back after NIP-59 backdating: shuffled, and with
    // clocks that disagree with the real order.
    const events = chain(6, (seq) => 1_755_500_000 - (seq % 3) * 86_400);
    const shuffled = [
      events[4]!,
      events[0]!,
      events[3]!,
      events[5]!,
      events[1]!,
      events[2]!,
    ];

    const [stream] = mergeStream(shuffled);

    expect(stream!.ordered.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stream!.gaps).toEqual([]);
    expect(stream!.forks).toEqual([]);
    expect(stream!.duplicates).toEqual([]);
  });

  it("reports a gap rather than closing it silently", () => {
    const events = chain(5, () => 1_755_500_000);
    const withHole = events.filter((e) => e.seq !== 3);

    const [stream] = mergeStream(withHole);

    expect(stream!.gaps).toEqual([{ stream: stream!.stream, missing: [3] }]);
    expect(stream!.ordered.map((e) => e.seq)).toEqual([1, 2, 4, 5]);
  });

  it("uses the head's last-seq as the ceiling for gap detection", () => {
    const events: SequencedEvent[] = chain(2, () => 1_755_500_000);
    const headRumor = buildSessionHead(AGENT, SESSION, {
      title: "t",
      status: "active",
      operator: { pubkey: OPERATOR },
      lastSeq: 5,
      started: 1_755_499_000,
      createdAt: 1_755_500_000,
    });
    const head = parseAgentEvent(headRumor) as DecodedHead;
    const [stream] = mergeStream(events, [head]);

    expect(stream!.gaps[0]!.missing).toEqual([3, 4, 5]);
  });

  it("detects a fork when prev does not name the event held at seq - 1", () => {
    const events = chain(3, () => 1_755_500_000);
    const impostor = turn(3, "f".repeat(64), 1_755_500_000);

    const [stream] = mergeStream([events[0]!, events[1]!, impostor]);

    expect(stream!.forks).toHaveLength(1);
    expect(stream!.forks[0]).toMatchObject({
      seq: 3,
      claimedPrev: "f".repeat(64),
    });
  });

  it("flags a duplicate seq — the signature of a replayed or forged event", () => {
    const events = chain(2, () => 1_755_500_000);
    const twin = turn(2, events[0]!.id, 1_755_500_099);

    const [stream] = mergeStream([...events, twin]);

    expect(stream!.duplicates).toHaveLength(1);
    expect(stream!.duplicates[0]!.seq).toBe(2);
    expect(stream!.duplicates[0]!.ids).toHaveLength(2);
  });

  it("does not treat the same event from two relays as a duplicate", () => {
    const events = chain(2, () => 1_755_500_000);

    const [stream] = mergeStream([...events, events[1]!]);

    expect(stream!.duplicates).toEqual([]);
    expect(stream!.ordered).toHaveLength(2);
  });
});

describe("newestHeads", () => {
  it("folds a session's head republishes to the newest", () => {
    const heads = [1_755_500_000, 1_755_500_500, 1_755_500_200].map(
      (createdAt) => {
        const rumor = buildSessionHead(AGENT, SESSION, {
          title: `at ${createdAt}`,
          status: "active",
          operator: { pubkey: OPERATOR },
          lastSeq: 1,
          started: 1_755_499_000,
          createdAt,
        });
        return parseAgentEvent(rumor) as DecodedHead;
      },
    );

    const folded = newestHeads(heads);

    expect(folded).toHaveLength(1);
    expect(folded[0]!.title).toBe("at 1755500500");
  });
});

describe("hostile input", () => {
  it("does not allocate a gap list from an attacker's last-seq", () => {
    // A `last-seq` tag is a decimal string anyone can write. Before it was
    // clamped, `mergeStream` walked 1..last-seq and a single event took the tab
    // out with a RangeError or an out-of-memory.
    const events = chain(1, () => 1_755_500_000);
    const headRumor = buildSessionHead(AGENT, SESSION, {
      title: "hostile",
      status: "active",
      operator: { pubkey: OPERATOR },
      lastSeq: 1,
      started: 1,
      createdAt: 1_755_500_000,
    });
    const hostile = {
      ...headRumor,
      tags: headRumor.tags.map((t) =>
        t[0] === "last-seq" ? ["last-seq", "99999999999999999999"] : t,
      ),
    };
    const head = parseAgentEvent({ ...hostile, id: headRumor.id });

    // The counter is refused outright, so the head decodes with no claim at all.
    const started = Date.now();
    const [stream] = mergeStream(events, head?.type === "head" ? [head] : []);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(stream!.gaps).toEqual([]);
  });

  it("caps how many missing sequence numbers it will name", () => {
    const events = chain(1, () => 1_755_500_000);
    const headRumor = buildSessionHead(AGENT, SESSION, {
      title: "sparse",
      status: "active",
      operator: { pubkey: OPERATOR },
      lastSeq: 50_000,
      started: 1,
      createdAt: 1_755_500_000,
    });
    const head = parseAgentEvent(headRumor) as DecodedHead;

    const [stream] = mergeStream(events, [head]);

    expect(stream!.gaps[0]!.missing.length).toBe(1000);
    expect(stream!.gaps[0]!.truncated).toBe(true);
  });
});
