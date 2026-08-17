import { describe, it, expect, beforeEach } from "vitest";

import db from "./db";
import { markAllDmsRead, markDmRead, readDmLastRead } from "./dm-reads";

const ME = "a".repeat(64);
const ONE = "conversation-one";
const TWO = "conversation-two";

beforeEach(async () => {
  await db.chatReads.clear();
});

describe("markAllDmsRead", () => {
  it("stamps each conversation at ITS OWN newest message", async () => {
    // Not at "now". A stamp is a position in a conversation, not a moment in
    // time — and a gift wrap routinely arrives later than its `created_at`, so
    // stamping the clock would swallow a message nobody has seen.
    await markAllDmsRead(ME, [
      { conversationId: ONE, lastAt: 1000 },
      { conversationId: TWO, lastAt: 2000 },
    ]);

    expect(await readDmLastRead(ME, ONE)).toBe(1000);
    expect(await readDmLastRead(ME, TWO)).toBe(2000);
  });

  it("never moves a conversation backwards", async () => {
    await markDmRead(ME, ONE, 5000);
    await markAllDmsRead(ME, [{ conversationId: ONE, lastAt: 1000 }]);
    expect(await readDmLastRead(ME, ONE)).toBe(5000);
  });

  it("clamps a message dated past the ceiling", async () => {
    const far = Math.floor(Date.now() / 1000) + 86_400;
    await markAllDmsRead(ME, [{ conversationId: ONE, lastAt: far }]);
    expect(await readDmLastRead(ME, ONE)).toBeLessThan(far);
  });

  it("ignores an entry with nothing to stamp", async () => {
    await markAllDmsRead(ME, [
      { conversationId: "", lastAt: 1000 },
      { conversationId: ONE, lastAt: 0 },
    ]);
    expect(await db.chatReads.count()).toBe(0);
  });

  it("does nothing at all with an empty list", async () => {
    await markAllDmsRead(ME, []);
    expect(await db.chatReads.count()).toBe(0);
  });

  it("leaves another account's stamps alone", async () => {
    const other = "b".repeat(64);
    await markDmRead(other, ONE, 4000);
    await markAllDmsRead(ME, [{ conversationId: ONE, lastAt: 1000 }]);
    expect(await readDmLastRead(other, ONE)).toBe(4000);
    expect(await readDmLastRead(ME, ONE)).toBe(1000);
  });
});
