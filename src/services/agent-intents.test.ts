import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _resetIntentsForTests,
  addIntent,
  getIntents,
  reconcileIntents,
  removeIntent,
  subscribeIntents,
} from "./agent-intents";
import type { DecodedTurn } from "@/lib/agent-session/types";

const AGENT = "agent-pubkey";
const SESSION = "session-1";

function turn(overrides: Partial<DecodedTurn> = {}): DecodedTurn {
  return {
    type: "turn",
    id: "turn-id",
    pubkey: AGENT,
    created_at: Math.floor(Date.now() / 1000),
    session: { agent: AGENT, session: SESSION },
    seq: 1,
    turn: 1,
    role: "user",
    parts: [{ type: "text", text: "steer this" }],
    subagents: [],
    ...overrides,
  };
}

afterEach(() => {
  _resetIntentsForTests();
});

describe("addIntent / removeIntent", () => {
  it("shows up under the session it was recorded for, and nowhere else", () => {
    addIntent(AGENT, SESSION, { command: "steer", text: "hi" });
    expect(getIntents(AGENT, SESSION)).toHaveLength(1);
    expect(getIntents(AGENT, "some-other-session")).toHaveLength(0);
  });

  it("rings listeners on the session it changed", () => {
    const heard = vi.fn();
    const stop = subscribeIntents(AGENT, SESSION, heard);
    const id = addIntent(AGENT, SESSION, { command: "cancel" });
    expect(heard).toHaveBeenCalledTimes(1);
    removeIntent(AGENT, SESSION, id);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(getIntents(AGENT, SESSION)).toHaveLength(0);
    stop();
  });

  it("removing an id that is not there rings nobody", () => {
    const heard = vi.fn();
    const stop = subscribeIntents(AGENT, SESSION, heard);
    removeIntent(AGENT, SESSION, "not-a-real-id");
    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});

describe("reconcileIntents", () => {
  it("drops a steer once a matching user turn arrives", () => {
    const id = addIntent(AGENT, SESSION, { command: "steer", text: "hi" });
    reconcileIntents(AGENT, SESSION, { turns: [] });
    expect(getIntents(AGENT, SESSION).map((i) => i.id)).toContain(id);

    reconcileIntents(AGENT, SESSION, {
      turns: [turn({ parts: [{ type: "text", text: "hi" }] })],
    });
    expect(getIntents(AGENT, SESSION)).toHaveLength(0);
  });

  it("leaves a steer whose text does not match anything yet", () => {
    addIntent(AGENT, SESSION, { command: "steer", text: "hi" });
    reconcileIntents(AGENT, SESSION, {
      turns: [turn({ parts: [{ type: "text", text: "something else" }] })],
    });
    expect(getIntents(AGENT, SESSION)).toHaveLength(1);
  });

  it("ignores an agent turn with the same words — only `user` echoes count", () => {
    addIntent(AGENT, SESSION, { command: "steer", text: "hi" });
    reconcileIntents(AGENT, SESSION, {
      turns: [
        turn({ role: "assistant", parts: [{ type: "text", text: "hi" }] }),
      ],
    });
    expect(getIntents(AGENT, SESSION)).toHaveLength(1);
  });

  it("drops a respond once the request leaves `pending`", () => {
    addIntent(AGENT, SESSION, {
      command: "respond",
      request: "req-1",
      option: "yes",
    });
    reconcileIntents(AGENT, SESSION, { turns: [], pending: ["req-1"] });
    expect(getIntents(AGENT, SESSION)).toHaveLength(1);

    reconcileIntents(AGENT, SESSION, { turns: [], pending: [] });
    expect(getIntents(AGENT, SESSION)).toHaveLength(0);
  });

  it("drops a cancel once the status leaves `active`", () => {
    addIntent(AGENT, SESSION, { command: "cancel" });
    reconcileIntents(AGENT, SESSION, { turns: [], status: "active" });
    expect(getIntents(AGENT, SESSION)).toHaveLength(1);

    reconcileIntents(AGENT, SESSION, { turns: [], status: "aborted" });
    expect(getIntents(AGENT, SESSION)).toHaveLength(0);
  });

  it("never touches a command it has no fact for, like compact", () => {
    addIntent(AGENT, SESSION, { command: "compact" });
    reconcileIntents(AGENT, SESSION, {
      turns: [turn()],
      pending: [],
      status: "idle",
    });
    expect(getIntents(AGENT, SESSION)).toHaveLength(1);
  });
});
