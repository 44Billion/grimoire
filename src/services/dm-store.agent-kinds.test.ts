import { beforeEach, describe, expect, it } from "vitest";
import type { Rumor as DmRumor } from "applesauce-common/helpers/gift-wrap";

import db from "./db";
import {
  DM_MAX_FUTURE_SECS,
  clearDirectMessages,
  dmUnreadSummary,
  foldDmMessages,
  listDmConversations,
  queryConversation,
  toDmRow,
  writeDmRumors,
} from "./dm-store";
import { listAgentSessions, readAgentSession } from "./agent-store";
import { buildSessionHead, buildTurn } from "@/lib/agent-session/encode";
import type { SessionRef } from "@/lib/agent-session/types";

/**
 * Agent turns ride the DM pipeline for its dedupe, decryption and backfill.
 * The whole arrangement rests on them never reaching the DM UI, so that is what
 * this file checks: accepted at ingest, invisible to every conversation query.
 */

const ME = "a".repeat(64);
const AGENT = "9".repeat(64);
const SESSION = "3a7c".padEnd(64, "0");
const ref: SessionRef = { agent: AGENT, session: SESSION };

const nowSecs = () => Math.floor(Date.now() / 1000);

function turn(seq: number, prev: string | undefined, createdAt = nowSecs()) {
  return buildTurn(
    AGENT,
    ref,
    {
      role: "assistant",
      blocks: [{ type: "text", text: `turn ${seq}` }],
      turn: seq,
      createdAt,
    },
    { seq, prev },
    { pubkey: ME },
    "full",
  ) as unknown as DmRumor;
}

function head(lastSeq: number, createdAt = nowSecs()) {
  return buildSessionHead(
    AGENT,
    SESSION,
    {
      title: "a run",
      status: "active",
      operator: { pubkey: ME },
      streams: [
        {
          transport: "nip17",
          address: ME,
          visibility: "private",
          redaction: "full",
        },
      ],
      lastSeq,
      turns: lastSeq,
      started: createdAt - 60,
      createdAt,
    },
    "full",
  ) as unknown as DmRumor;
}

describe("agent kinds in the DM store", () => {
  beforeEach(async () => {
    await clearDirectMessages(ME);
  });

  it("accepts an agent turn at ingest", () => {
    const row = toDmRow(ME, turn(1, undefined));

    expect("rejected" in row).toBe(false);
  });

  it("still refuses a turn whose id lies", () => {
    const lying = { ...turn(1, undefined), id: "f".repeat(64) };

    expect(toDmRow(ME, lying)).toMatchObject({
      rejected: "rumor id does not match",
    });
  });

  it("still refuses a turn dated too far in the future", () => {
    const future = turn(1, undefined, nowSecs() + DM_MAX_FUTURE_SECS + 60);

    expect(toDmRow(ME, future)).toMatchObject({
      rejected: "rumor is dated too far in the future",
    });
  });

  it("refuses a turn addressed to somebody else", () => {
    const notMine = buildTurn(
      AGENT,
      ref,
      { role: "assistant", blocks: [], turn: 1 },
      { seq: 1 },
      { pubkey: "b".repeat(64) },
      "full",
    ) as unknown as DmRumor;

    expect(toDmRow(ME, notMine)).toMatchObject({
      rejected: "viewer is not a participant",
    });
  });

  it("never shows up in a conversation, a fold, or an unread badge", async () => {
    const first = turn(1, undefined);
    await writeDmRumors(ME, [first, turn(2, first.id), head(2)]);

    const conversations = await listDmConversations(ME);
    expect(conversations).toEqual([]);

    const filed = new Set(
      (await db.dmRumors.where({ viewer: ME }).toArray()).map(
        (row) => row.conversationId,
      ),
    );
    expect(filed.size).toBeGreaterThan(0); // they ARE stored, just not shown

    for (const conversationId of filed) {
      const rows = await queryConversation(ME, conversationId);
      expect(foldDmMessages(rows)).toEqual([]);
      expect(
        (await dmUnreadSummary(ME, conversationId, { after: 0 })).count,
      ).toBe(0);
    }
  });

  it("reads back as a session, ordered by seq", async () => {
    const first = turn(1, undefined, nowSecs() - 5);
    const second = turn(2, first.id, nowSecs() - 500); // an older clock, later seq
    await writeDmRumors(ME, [second, first, head(2)]);

    const sessions = await listAgentSessions(ME);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.title).toBe("a run");

    const view = await readAgentSession(ME, AGENT, SESSION);
    expect(view.turns.map((t) => t.seq)).toEqual([1, 2]);
    expect(view.gaps).toEqual([]);
    expect(view.forks).toEqual([]);
    expect(view.duplicates).toEqual([]);
  });

  it("reports a hole in a transcript rather than closing it", async () => {
    const first = turn(1, undefined);
    const third = turn(3, "f".repeat(64));
    await writeDmRumors(ME, [first, third, head(3)]);

    const view = await readAgentSession(ME, AGENT, SESSION);

    expect(view.gaps).toContain(2);
  });

  it("does not read a head republish as a duplicate sequence", async () => {
    const first = turn(1, undefined);
    await writeDmRumors(ME, [
      first,
      head(1, nowSecs() - 30),
      head(1, nowSecs() - 10),
    ]);

    const view = await readAgentSession(ME, AGENT, SESSION);

    expect(view.duplicates).toEqual([]);
    expect(view.head?.lastSeq).toBe(1);
  });
});
