import { describe, expect, it } from "vitest";

import {
  gitActivityRows,
  MAX_GIT_ROWS,
  MIN_GIT_ROWS,
} from "@/lib/concord/git-activity";
import { parseGitRepositoryAddress } from "@/lib/concord/git";
import type { GitRepositoryAttachment } from "@/lib/concord/git";
import type { NostrEvent } from "@/types/nostr";

const OWNER =
  "7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194";
const COORD = `30617:${OWNER}:grimoire`;
const OTHER = `30617:${OWNER}:chachi`;

function attachment(
  over: Partial<GitRepositoryAttachment> = {},
): GitRepositoryAttachment {
  return {
    address: parseGitRepositoryAddress(COORD)!,
    relayHints: ["wss://relay.ngit.dev"],
    attachedAt: 100,
    ...over,
  };
}

let seq = 0;
function event(over: Partial<NostrEvent> & { kind: number }): NostrEvent {
  seq += 1;
  return {
    id: `id${seq}`.padEnd(64, "0"),
    pubkey: OWNER,
    created_at: 200,
    tags: [["a", COORD]],
    content: "",
    sig: "",
    ...over,
  } as NostrEvent;
}

const issue = (over: Partial<NostrEvent> = {}) =>
  event({
    kind: 1621,
    tags: [
      ["a", COORD],
      ["subject", "Timelines hang in LOADING"],
    ],
    ...over,
  });

describe("gitActivityRows", () => {
  it("renders an issue as a system row carrying its pointer", () => {
    const [row] = gitActivityRows([issue()], [attachment()], "conv", 100);
    expect(row.type).toBe("system");
    expect(row.content).toBe("opened issue Timelines hang in LOADING");
    expect(row.metadata?.git?.action).toBe("opened issue");
    expect(row.metadata?.git?.subject).toBe("Timelines hang in LOADING");
    expect(row.metadata?.git?.pointer.kind).toBe(1621);
    expect(row.metadata?.git?.pointer.relays).toEqual(["wss://relay.ngit.dev"]);
  });

  it("names patches and pull requests for what they are", () => {
    const rows = gitActivityRows(
      [
        event({
          kind: 1617,
          tags: [["a", COORD]],
          content: "Subject: [PATCH] fix\n",
        }),
        event({
          kind: 1618,
          tags: [
            ["a", COORD],
            ["subject", "Port the fold"],
          ],
        }),
      ],
      [attachment()],
      "conv",
      100,
    );
    expect(rows.map((r) => r.metadata?.git?.action)).toEqual([
      "sent a patch",
      "opened a pull request",
    ]);
  });

  it("shows the repository in a channel that has no chat yet", () => {
    // Nothing to drown out, and an empty pane under a repo badge reads as a
    // broken feature rather than a quiet room.
    const rows = gitActivityRows([issue()], [attachment()], "conv", undefined);
    expect(rows).toHaveLength(1);
  });

  it("drops activity older than the loaded page, once the page has enough", () => {
    const older = Array.from({ length: MIN_GIT_ROWS }, (_, i) =>
      issue({ created_at: 400 + i }),
    );
    const rows = gitActivityRows(
      [issue({ created_at: 150 }), ...older],
      [attachment()],
      "conv",
      300,
    );
    expect(rows.map((r) => r.timestamp)).toEqual(
      older.map((e) => e.created_at),
    );
  });

  it("keeps the newest few whatever their age, so a quiet repository shows", () => {
    // The ordinary case: a channel attached last week, a repository whose last
    // patch landed months before any of the chat on screen.
    const rows = gitActivityRows(
      [issue({ created_at: 150 })],
      [attachment()],
      "conv",
      100_000,
    );
    expect(rows.map((r) => r.timestamp)).toEqual([150]);
  });

  it("keeps work that predates the attachment", () => {
    const rows = gitActivityRows(
      [issue({ created_at: 50 })],
      [attachment({ attachedAt: 100 })],
      "conv",
      1,
    );
    expect(rows).toHaveLength(1);
  });

  it("drops an event written after the repository was detached", () => {
    const detached = attachment({ attachedAt: 100, detachedAt: 300 });
    const rows = gitActivityRows(
      [issue({ created_at: 250 }), issue({ created_at: 350 })],
      [detached],
      "conv",
      100,
    );
    expect(rows.map((r) => r.timestamp)).toEqual([250]);
  });

  it("ignores an event naming a repository this channel never attached", () => {
    const rows = gitActivityRows(
      [issue({ tags: [["a", OTHER]] })],
      [attachment()],
      "conv",
      100,
    );
    expect(rows).toEqual([]);
  });

  it("renders a status only when its ticket is in hand", () => {
    const ticket = issue({ created_at: 210 });
    const closed = (rootId: string) =>
      event({
        kind: 1632,
        created_at: 220,
        tags: [
          ["a", COORD],
          ["e", rootId, "", "root"],
        ],
      });
    const withTicket = gitActivityRows(
      [ticket, closed(ticket.id)],
      [attachment()],
      "conv",
      100,
    );
    expect(withTicket.map((r) => r.metadata?.git?.action)).toEqual([
      "opened issue",
      "closed",
    ]);
    expect(withTicket[1].metadata?.git?.subject).toBe(
      "Timelines hang in LOADING",
    );
    expect(withTicket[1].metadata?.git?.ticket?.id).toBe(ticket.id);

    const orphan = gitActivityRows(
      [closed("f".repeat(64))],
      [attachment()],
      "conv",
      100,
    );
    expect(orphan).toEqual([]);
  });

  it("a resolved patch reads as merged, a resolved issue as resolved", () => {
    const patch = event({ kind: 1618, created_at: 210, tags: [["a", COORD]] });
    const ticket = issue({ created_at: 210 });
    const applied = (rootId: string) =>
      event({
        kind: 1631,
        created_at: 220,
        tags: [
          ["a", COORD],
          ["e", rootId, "", "root"],
        ],
      });
    expect(
      gitActivityRows(
        [patch, applied(patch.id)],
        [attachment()],
        "conv",
        100,
      )[1].metadata?.git?.action,
    ).toBe("merged");
    expect(
      gitActivityRows(
        [ticket, applied(ticket.id)],
        [attachment()],
        "conv",
        100,
      )[1].metadata?.git?.action,
    ).toBe("resolved");
  });

  it("keeps the newest rows when a repository floods", () => {
    const many = Array.from({ length: MAX_GIT_ROWS + 20 }, (_, i) =>
      issue({ created_at: 1000 + i }),
    );
    const rows = gitActivityRows(many, [attachment()], "conv", 100);
    expect(rows).toHaveLength(MAX_GIT_ROWS);
    expect(rows[rows.length - 1].timestamp).toBe(1000 + MAX_GIT_ROWS + 19);
  });

  it("renders nothing for a channel with no attachment", () => {
    expect(gitActivityRows([issue()], [], "conv", 100)).toEqual([]);
  });
});
