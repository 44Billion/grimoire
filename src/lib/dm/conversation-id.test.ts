import { describe, expect, it } from "vitest";

import { dmConversationIdFor, dmOthersIn } from "./conversation-id";

const ME = "a".repeat(64);
const PEER = "b".repeat(64);
const THIRD = "c".repeat(64);

describe("dmConversationIdFor", () => {
  it("gives one pubkey and the id it produces the same answer", () => {
    const id = dmConversationIdFor(ME, PEER);
    expect(dmConversationIdFor(ME, id)).toBe(id);
  });

  it("does not confuse a group with the 1:1 its first member would open", () => {
    // The bug this exists for: a three-way conversation's rows are filed under
    // all three, and a sidebar row that opened it by its first participant
    // asked for a conversation that has never had a message in it — an unread
    // badge over an empty timeline, with a read stamp that could not clear it.
    const group = dmConversationIdFor(ME, [PEER, THIRD].join(":"));
    expect(group).not.toBe(dmConversationIdFor(ME, PEER));
    expect(group.split(":")).toHaveLength(3);
  });

  it("normalises order and repeats, so both sides agree", () => {
    expect(dmConversationIdFor(ME, `${THIRD}:${PEER}:${PEER}:${ME}`)).toBe(
      dmConversationIdFor(ME, `${PEER}:${THIRD}`),
    );
  });

  it("names a conversation with yourself after you alone", () => {
    expect(dmConversationIdFor(ME, ME)).toBe(ME);
    expect(dmConversationIdFor(ME, "")).toBe(ME);
  });
});

describe("dmOthersIn", () => {
  it("drops the viewer and keeps everyone else", () => {
    const id = dmConversationIdFor(ME, `${PEER}:${THIRD}`);
    expect(dmOthersIn(id, ME).sort()).toEqual([PEER, THIRD].sort());
  });

  it("is empty for a note to yourself", () => {
    expect(dmOthersIn(ME, ME)).toEqual([]);
  });
});
