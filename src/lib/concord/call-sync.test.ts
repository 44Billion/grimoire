/**
 * §7 enforcement, which is the only moderation a blind SFU can carry: removal
 * from the Channel is removal from its calls, and the lever is the key rotation
 * rather than any signed edict the SFU could honour.
 *
 * The fail-safe direction is asymmetric on purpose — a missing fold must never
 * hang up a working call, while a ban must hang up regardless of what has
 * loaded.
 */

import { describe, expect, it } from "vitest";

import {
  banVerdictPostdatesMembership,
  decideCallSync,
} from "@/lib/concord/call-sync";
import { voiceKeysOf } from "@/lib/concord/channels";
import { bytesToHex, channelGroupKey, random32 } from "@/lib/concord/derive";
import type { FoldedControl } from "@/lib/concord/control";
import type { Channel, Community } from "@/lib/concord/types";

const root = random32();
const channelId = random32();
const CHANNEL = bytesToHex(channelId);
const OWNER = "aa".repeat(32);
const ME = "bb".repeat(32);

function channel(epoch = 0n): Channel {
  const group = channelGroupKey(root, channelId, epoch);
  return {
    id: channelId,
    idHex: CHANNEL,
    name: "#general",
    isPrivate: false,
    streams: [{ epoch, group }],
    current: { epoch, group },
    voice: voiceKeysOf(root, channelId, epoch),
  };
}

function community(): Community {
  return {
    idHex: "cc".repeat(32),
    id: random32(),
    controlPk: "dd".repeat(32),
    ownerHex: OWNER,
    ownerSaltHex: "ee".repeat(32),
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays: [],
    name: "Test",
  } as unknown as Community;
}

function folded(over: Partial<FoldedControl> = {}): FoldedControl {
  return {
    roster: { roles: [], grants: [] },
    ownerHex: OWNER,
    channels: new Map(),
    banned: new Set(),
    bannedAt: new Map(),
    pins: new Map(),
    inviteLinks: new Map(),
    heads: new Map(),
    incomplete: [],
    ...over,
  } as unknown as FoldedControl;
}

function snapshotOf(ch: Channel) {
  return {
    channelIdHex: ch.idHex,
    epoch: ch.current.epoch,
    roomPk: ch.voice.room.pk,
  };
}

describe("banVerdictPostdatesMembership", () => {
  it("is a verdict only when the sentence postdates the join", () => {
    const banned = folded({
      banned: new Set([ME]),
      bannedAt: new Map([[ME, 2_000]]),
    });
    expect(banVerdictPostdatesMembership(banned, ME, 1_000_000)).toBe(true);
    // A compaction re-wraps banlist editions verbatim, so an old sentence can
    // outlive a re-admission — that is a stale verdict, not a judgment.
    expect(banVerdictPostdatesMembership(banned, ME, 3_000_000)).toBe(false);
  });

  it("never convicts the owner, and never guesses without a join time", () => {
    const banned = folded({
      banned: new Set([OWNER, ME]),
      bannedAt: new Map([
        [OWNER, 2_000],
        [ME, 2_000],
      ]),
    });
    expect(banVerdictPostdatesMembership(banned, OWNER, 1_000)).toBe(false);
    expect(banVerdictPostdatesMembership(banned, ME, undefined)).toBe(false);
    expect(banVerdictPostdatesMembership(undefined, ME, 1_000)).toBe(false);
  });
});

describe("decideCallSync (§7)", () => {
  const ch = channel();

  it("stays while the live coordinates match the snapshot", () => {
    expect(
      decideCallSync({
        snapshot: snapshotOf(ch),
        listLoaded: true,
        community: community(),
        folded: folded(),
        channels: [ch],
        selfBanned: false,
      }),
    ).toEqual({ action: "stay" });
  });

  it("hangs up on a ban even before anything else has loaded", () => {
    expect(
      decideCallSync({
        snapshot: snapshotOf(ch),
        listLoaded: false,
        community: undefined,
        folded: undefined,
        channels: [],
        selfBanned: true,
      }),
    ).toEqual({ action: "leave", reason: "banned" });
  });

  it("hangs up once the vault has loaded without this community", () => {
    expect(
      decideCallSync({
        snapshot: snapshotOf(ch),
        listLoaded: true,
        community: undefined,
        folded: undefined,
        channels: [],
        selfBanned: false,
      }),
    ).toEqual({ action: "leave", reason: "removed" });
  });

  it("stays put while state is merely missing, never tearing down on a lag", () => {
    expect(
      decideCallSync({
        snapshot: snapshotOf(ch),
        listLoaded: false,
        community: undefined,
        folded: undefined,
        channels: [],
        selfBanned: false,
      }),
    ).toEqual({ action: "stay" });
    expect(
      decideCallSync({
        snapshot: snapshotOf(ch),
        listLoaded: true,
        community: community(),
        folded: undefined,
        channels: [],
        selfBanned: false,
      }),
    ).toEqual({ action: "stay" });
  });

  it("rejoins the freshly derived room when the epoch rolls", () => {
    // The rotation that severs a removed member from chat has to move the call
    // too, or everyone stays in the room that member can still derive.
    const rolled = channel(1n);
    const decision = decideCallSync({
      snapshot: snapshotOf(ch),
      listLoaded: true,
      community: community(),
      folded: folded(),
      channels: [rolled],
      selfBanned: false,
    });
    expect(decision.action).toBe("rejoin");
    expect(
      decision.action === "rejoin" ? decision.channel.voice.room.pk : undefined,
    ).toBe(rolled.voice.room.pk);
    expect(rolled.voice.room.pk).not.toBe(ch.voice.room.pk);
  });

  it("hangs up when the channel leaves the live view", () => {
    // Deleted, or a private channel whose rotated key we were not dealt: either
    // way the new room is underivable.
    expect(
      decideCallSync({
        snapshot: snapshotOf(ch),
        listLoaded: true,
        community: community(),
        folded: folded(),
        channels: [],
        selfBanned: false,
      }),
    ).toEqual({ action: "leave", reason: "channel-gone" });
  });
});
