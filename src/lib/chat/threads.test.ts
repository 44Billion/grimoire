import { describe, it, expect } from "vitest";
import type { Message } from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import { foldThreads } from "./threads";

/**
 * Every case here is a message that could vanish. The fold removes rows from a
 * timeline, and each rule below is the reason one particular row is allowed to
 * go or must be left alone — none of which the compiler can see.
 */

let clock = 1_700_000_000;

function msg(
  id: string,
  opts: {
    parent?: string;
    root?: string;
    author?: string;
    type?: Message["type"];
  } = {},
): Message {
  return {
    id,
    conversationId: "c",
    author: opts.author ?? "author-" + id,
    content: id,
    timestamp: clock++,
    type: opts.type ?? "user",
    protocol: "nip-29",
    event: { id } as NostrEvent,
    ...(opts.parent ? { replyTo: { id: opts.parent } } : {}),
    ...(opts.root ? { threadRoot: opts.root } : {}),
  };
}

const ids = (messages: readonly Message[]) => messages.map((m) => m.id);

describe("foldThreads", () => {
  it("folds a reply under its parent and summarises it", () => {
    const messages = [msg("a"), msg("b"), msg("r1", { parent: "b" })];
    const { rows, threads, replyToRoot } = foldThreads(messages, {
      collapse: true,
    });

    expect(ids(rows)).toEqual(["a", "b"]);
    expect(threads.get("b")).toMatchObject({
      rootId: "b",
      replyIds: ["r1"],
      repliers: ["author-r1"],
      latest: messages[2].timestamp,
    });
    expect(replyToRoot.get("r1")).toBe("b");
  });

  it("flattens a reply to a reply onto the thread root", () => {
    // The pane is a flat log, so a grandchild belongs to the root's thread and
    // is counted there. Left under its own parent it would be a thread nobody
    // can open — the parent has no row.
    const messages = [
      msg("root"),
      msg("r1", { parent: "root" }),
      msg("r2", { parent: "r1" }),
    ];
    const { rows, threads } = foldThreads(messages, { collapse: true });

    expect(ids(rows)).toEqual(["root"]);
    expect(threads.size).toBe(1);
    expect(threads.get("root")?.replyIds).toEqual(["r1", "r2"]);
  });

  it("prefers a stated threadRoot over walking the chain", () => {
    // The Concord kind-1111 case: `E` names the root even when the intermediate
    // reply never loaded, which a parent walk could not have found.
    const messages = [
      msg("root"),
      msg("deep", { parent: "gone", root: "root" }),
    ];
    const { rows, threads } = foldThreads(messages, { collapse: true });

    expect(ids(rows)).toEqual(["root"]);
    expect(threads.get("root")?.replyIds).toEqual(["deep"]);
  });

  it("leaves an orphan as a top-level row", () => {
    // Rule 3. The parent is outside the loaded window, so there is nothing to
    // fold under. A flat reply is legible; a hidden one is indistinguishable
    // from a message nobody sent.
    const messages = [msg("a"), msg("orphan", { parent: "not-loaded" })];
    const { rows, threads, replyToRoot } = foldThreads(messages, {
      collapse: true,
    });

    expect(ids(rows)).toEqual(["a", "orphan"]);
    expect(threads.size).toBe(0);
    expect(replyToRoot.size).toBe(0);
  });

  it("keeps a conversation that IS a thread flat", () => {
    // NIP-10, NIP-22 and NIP-53: every row replies to the conversation's own
    // root. Without the rule the whole timeline folds into one hidden thread.
    const messages = [
      msg("root"),
      msg("c1", { parent: "root", root: "root" }),
      msg("c2", { parent: "root", root: "root" }),
    ];
    const { rows, threads } = foldThreads(messages, {
      collapse: true,
      conversationRootId: "root",
    });

    expect(ids(rows)).toEqual(["root", "c1", "c2"]);
    expect(threads.size).toBe(0);
  });

  it("still threads a sub-reply in a conversation that IS a thread", () => {
    // The corollary: replying to a COMMENT is a genuine thread even where
    // replying to the root is not.
    const messages = [
      msg("root"),
      msg("c1", { parent: "root", root: "root" }),
      msg("c2", { parent: "c1" }),
    ];
    const { rows, threads } = foldThreads(messages, {
      collapse: true,
      conversationRootId: "root",
    });

    expect(ids(rows)).toEqual(["root", "c1"]);
    expect(threads.get("c1")?.replyIds).toEqual(["c2"]);
  });

  it("never folds a system or zap row, and never hosts a thread on one", () => {
    // `groupSystemMessages` collapses system rows, and a folded one would take
    // a jump target with it.
    const messages = [
      msg("sys", { type: "system", parent: "a" }),
      msg("a"),
      msg("zap", { type: "zap", parent: "a" }),
      msg("under-sys", { parent: "sys" }),
    ];
    const { rows, threads } = foldThreads(messages, { collapse: true });

    expect(ids(rows)).toEqual(["sys", "a", "zap", "under-sys"]);
    expect(threads.size).toBe(0);
  });

  it("dedupes repliers in first-reply order and tracks the newest reply", () => {
    const messages = [
      msg("root"),
      msg("r1", { parent: "root", author: "alice" }),
      msg("r2", { parent: "root", author: "bob" }),
      msg("r3", { parent: "root", author: "alice" }),
    ];
    const { threads } = foldThreads(messages, { collapse: true });

    expect(threads.get("root")?.repliers).toEqual(["alice", "bob"]);
    expect(threads.get("root")?.latest).toBe(messages[3].timestamp);
  });

  it("returns the same array identity when not collapsing", () => {
    // The caller's memo and the Virtuoso prepend anchor both compare identity;
    // a copy would re-key every row on a toggle that changed nothing.
    const messages = [msg("root"), msg("r1", { parent: "root" })];
    const { rows, threads, replyToRoot } = foldThreads(messages, {
      collapse: false,
    });

    expect(rows).toBe(messages);
    expect(threads.get("root")?.replyIds).toEqual(["r1"]);
    expect(replyToRoot.size).toBe(0);
  });

  it("returns the same array identity when nothing is threaded", () => {
    const messages = [msg("a"), msg("b")];
    expect(foldThreads(messages, { collapse: true }).rows).toBe(messages);
  });

  it("does not hang on a reply cycle", () => {
    const messages = [msg("x", { parent: "y" }), msg("y", { parent: "x" })];
    const { rows } = foldThreads(messages, { collapse: true });
    expect(ids(rows).sort()).toEqual(["x", "y"]);
  });

  it("ignores a message that names itself as its own parent", () => {
    const messages = [msg("self", { parent: "self" })];
    expect(ids(foldThreads(messages, { collapse: true }).rows)).toEqual([
      "self",
    ]);
  });
});
