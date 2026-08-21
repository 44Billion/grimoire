import { beforeEach, describe, expect, it } from "vitest";
import type { Rumor as DmRumor } from "applesauce-common/helpers/gift-wrap";

import db from "./db";
import { clearDirectMessages, writeDmRumors } from "./dm-store";
import { writeChatRumors } from "./concord-rumor-store";
import { listAgentSessions, readAgentSession } from "./agent-store";
import { buildSessionHead, buildTurn } from "@/lib/agent-session/encode";
import type { OpenedEvent } from "@/lib/concord/stream";
import type { Rumor, SessionRef } from "@/lib/agent-session/types";

/**
 * A run an agent carried on a Concord channel is readable by the channel: the
 * transcript is sealed under the key every member already holds, so the pane
 * has to find it in the Concord store as well as in the DM inbox. Reading only
 * the inbox left a room full of keyholders looking at a pointer to a session
 * none of them could open.
 */

const ME = "a".repeat(64);
const AGENT = "9".repeat(64);
const SESSION = "3a7c".padEnd(64, "0");
const COMMUNITY = "c0".repeat(32);
const CHANNEL = "ce".repeat(32);
const ref: SessionRef = { agent: AGENT, session: SESSION };

const nowSecs = () => Math.floor(Date.now() / 1000);

/** The binding a Concord rumor carries, and without which it never arrives. */
const binding = [
  ["channel", CHANNEL],
  ["epoch", "2"],
];

function turn(seq: number, prev?: string, tags: string[][] = []) {
  const built = buildTurn(
    AGENT,
    ref,
    {
      role: "assistant",
      parts: [{ type: "text", text: `turn ${seq}` }],
      turn: seq,
      createdAt: nowSecs(),
    },
    { seq, prev },
    { pubkey: ME },
  ) as unknown as Rumor;
  return { ...built, tags: [...built.tags, ...tags] };
}

function head(lastSeq: number, tags: string[][] = []) {
  const built = buildSessionHead(AGENT, SESSION, {
    title: "a run in a channel",
    status: "active",
    operator: { pubkey: ME },
    lastSeq,
    started: nowSecs() - 60,
    createdAt: nowSecs(),
  }) as unknown as Rumor;
  return { ...built, tags: [...built.tags, ...tags] };
}

/** What the wire hands the store once a wrap is open. */
function opened(rumor: Rumor): OpenedEvent & { channel: string } {
  return {
    rumorId: rumor.id,
    author: rumor.pubkey,
    kind: rumor.kind,
    content: rumor.content,
    tags: rumor.tags,
    createdAt: rumor.created_at,
    ms: rumor.created_at * 1000,
    channel: CHANNEL,
  };
}

async function joinCommunity() {
  await db.concordCommunities.put({
    pubkey: ME,
    idHex: COMMUNITY,
    entry: {},
    name: "Mages Guild",
    listEventId: "e".repeat(64),
    listCreatedAt: nowSecs(),
    updatedAt: nowSecs(),
  });
}

describe("a session carried on a Concord channel", () => {
  beforeEach(async () => {
    await clearDirectMessages(ME);
    await db.concordRumors.clear();
    await db.concordCommunities.clear();
  });

  it("is listed and read from the channel store, with no wrap addressed to us", async () => {
    await joinCommunity();
    const first = turn(1, undefined, binding);
    await writeChatRumors(COMMUNITY, [
      opened(first),
      opened(turn(2, first.id, binding)),
      opened(head(2, binding)),
    ]);

    // Nothing was ever gift-wrapped to this viewer: the key that opened it is
    // the channel's, which is the whole point of the carriage.
    expect(await db.dmRumors.count()).toBe(0);

    const sessions = await listAgentSessions(ME);
    expect(sessions.map((session) => session.session.session)).toEqual([
      SESSION,
    ]);

    const view = await readAgentSession(ME, AGENT, SESSION);
    expect(view.head?.lastSeq).toBe(2);
    expect(view.turns).toHaveLength(2);
    // The ordering rules still apply — a chain read out of the other store is
    // still a chain.
    expect(view.gaps).toEqual([]);
    expect(view.forks).toEqual([]);
  });

  it("counts an event held in both stores once", async () => {
    await joinCommunity();
    // A member who is ALSO a transcript recipient holds the same rumor twice.
    // The two copies are one event — the agent binds before wrapping so the ids
    // match — and counting it twice would report a duplicate at every seq.
    const only = turn(1, undefined, binding);
    await writeChatRumors(COMMUNITY, [opened(only), opened(head(1, binding))]);
    await writeDmRumors(ME, [only as unknown as DmRumor]);

    const view = await readAgentSession(ME, AGENT, SESSION);
    expect(view.turns).toHaveLength(1);
    expect(view.duplicates).toEqual([]);
  });

  it("reads nothing out of a community this viewer has not joined", async () => {
    // `communityId` is in every index of that store and must be in every query.
    // A session in somebody else's community is not this viewer's to list.
    await writeChatRumors(COMMUNITY, [opened(head(1, binding))]);

    expect(await listAgentSessions(ME)).toEqual([]);
  });
});
