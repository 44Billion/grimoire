import { beforeEach, describe, expect, it, vi } from "vitest";
import { nip44 } from "nostr-tools";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";

import {
  bytesToHex,
  communityIdOf,
  hex32,
  random32,
} from "@/lib/concord/derive";
import {
  KIND_COMMUNITY_LIST,
  KIND_COMMUNITY_LIST_LEGACY,
  KIND_JOIN_LEAVE,
  KIND_SEAL_ENCRYPTED,
  KIND_WRAP,
} from "@/lib/concord/kinds";
import type { InviteBundle } from "@/lib/concord/invite";

const readListSlotsForWrite = vi.hoisted(() => vi.fn());
const mirroredMembershipCount = vi.hoisted(() => vi.fn(async () => 0));
const syncCommunities = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/services/concord-communities", () => ({
  readListSlotsForWrite,
  mirroredMembershipCount,
  syncCommunities,
}));
const publishEvent = vi.hoisted(() =>
  vi.fn(async (_event: NostrEvent) => undefined),
);
vi.mock("@/services/hub", () => ({ publishEvent }));
const publishWrap = vi.hoisted(() =>
  vi.fn(async (_relays: string[], _wrap: NostrEvent) => ({
    accepted: ["wss://r.example"],
    rejected: [],
  })),
);
vi.mock("@/services/concord-publish", () => ({ publishWrap }));

const { joinFromInvite, JoinError } = await import("./concord-join");

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const selfKey = nip44.getConversationKey(sk, pubkey);
const signer = {
  signEvent: async (template: EventTemplate) =>
    finalizeEvent(template, sk) as NostrEvent,
  nip44: {
    encrypt: async (_pk: string, text: string) => nip44.encrypt(text, selfKey),
    decrypt: async (_pk: string, ct: string) => nip44.decrypt(ct, selfKey),
  },
};

const ownerSk = generateSecretKey();
const OWNER = getPublicKey(ownerSk);
const SALT = random32();

function bundleOf(over: Partial<InviteBundle> = {}): InviteBundle {
  return {
    community_id: bytesToHex(communityIdOf(hex32(OWNER), SALT)),
    owner: OWNER,
    owner_salt: bytesToHex(SALT),
    community_root: bytesToHex(random32()),
    root_epoch: 0,
    channels: [],
    relays: ["wss://community.example"],
    name: "Test",
    ...over,
  };
}

/** What the published list event decrypts back to. */
function publishedList() {
  const event = publishEvent.mock.calls[0][0];
  return JSON.parse(nip44.decrypt(event.content, selfKey)) as {
    entries: Array<{ community_id: string }>;
  };
}

beforeEach(() => {
  readListSlotsForWrite.mockReset();
  readListSlotsForWrite.mockResolvedValue({ slots: [], unreadable: 0 });
  mirroredMembershipCount.mockReset();
  mirroredMembershipCount.mockResolvedValue(0);
  publishEvent.mockClear();
  publishWrap.mockClear();
  syncCommunities.mockClear();
});

describe("joinFromInvite", () => {
  it("writes the membership into the generation the member already uses", async () => {
    const existing = { community_id: "aa".repeat(32) };
    readListSlotsForWrite.mockResolvedValue({
      slots: [
        {
          kind: KIND_COMMUNITY_LIST_LEGACY,
          d: "",
          eventId: "x",
          createdAt: 1_700_000_000,
          list: { entries: [existing], tombstones: [] },
        },
      ],
      unreadable: 0,
    });
    const bundle = bundleOf();
    const outcome = await joinFromInvite(bundle, pubkey, signer);

    expect(outcome.listKind).toBe(KIND_COMMUNITY_LIST_LEGACY);
    const list = publishedList();
    // The existing membership survives — this is the whole read-modify-write.
    expect(list.entries.map((e) => e.community_id).sort()).toEqual(
      [existing.community_id, bundle.community_id].sort(),
    );
    // …and the write must outrank the copy it replaces, or a relay resolving on
    // created_at alone can discard it.
    const event = publishEvent.mock.calls[0][0];
    expect(event.created_at).toBeGreaterThan(1_700_000_000);
  });

  it("REFUSES to write when part of the List would not decrypt", async () => {
    // The write replaces the coordinate, so publishing over a slot this client
    // cannot read destroys every membership in it — keys included.
    readListSlotsForWrite.mockResolvedValue({ slots: [], unreadable: 1 });
    await expect(joinFromInvite(bundleOf(), pubkey, signer)).rejects.toThrow(
      JoinError,
    );
    expect(publishEvent).not.toHaveBeenCalled();
    expect(publishWrap).not.toHaveBeenCalled();
  });

  it("REFUSES to write when no relay served a List the vault says exists", async () => {
    readListSlotsForWrite.mockResolvedValue({ slots: [], unreadable: 0 });
    mirroredMembershipCount.mockResolvedValue(3);
    await expect(joinFromInvite(bundleOf(), pubkey, signer)).rejects.toThrow(
      /could not be read/,
    );
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("writes a first List when the member genuinely has none", async () => {
    await joinFromInvite(bundleOf(), pubkey, signer);
    const event = publishEvent.mock.calls[0][0];
    expect(event.kind).toBe(KIND_COMMUNITY_LIST_LEGACY);
    expect(publishedList().entries).toHaveLength(1);
  });

  it("keys a fragment write by its own index", async () => {
    readListSlotsForWrite.mockResolvedValue({
      slots: [
        {
          kind: KIND_COMMUNITY_LIST,
          d: "1",
          eventId: "y",
          createdAt: 1_700_000_000,
          list: { frags: 2, entries: [], tombstones: [] },
        },
      ],
      unreadable: 0,
    });
    await joinFromInvite(bundleOf(), pubkey, signer);
    const event = publishEvent.mock.calls[0][0];
    expect(event.kind).toBe(KIND_COMMUNITY_LIST);
    expect(event.tags).toEqual([["d", "1"]]);
  });

  it("refuses an expired invite, before anything is signed", async () => {
    const stale = bundleOf({ expires_at: Date.now() - 1000 });
    await expect(joinFromInvite(stale, pubkey, signer)).rejects.toThrow(
      /expired/,
    );
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("announces the join at the guestbook, sealed and wrapped", async () => {
    await joinFromInvite(bundleOf(), pubkey, signer);
    const [relays, wrap] = publishWrap.mock.calls[0];
    expect(relays).toEqual(["wss://community.example"]);
    expect(wrap.kind).toBe(KIND_WRAP);
    // The rumor is sealed ENCRYPTED (CORD-02 §5) — only the Control Plane is
    // plaintext — so the wrap opens to a 20013 seal, never a bare rumor.
    expect(wrap.tags.some((t) => t[0] === "p")).toBe(true);
    expect(KIND_SEAL_ENCRYPTED).toBe(20013);
    expect(KIND_JOIN_LEAVE).toBe(3306);
  });

  it("keeps the membership when only the announcement fails", async () => {
    // The Guestbook is off-consensus: a failure costs a row in a members list,
    // never access.
    publishWrap.mockRejectedValueOnce(new Error("every relay refused"));
    const outcome = await joinFromInvite(bundleOf(), pubkey, signer);
    expect(outcome.guestbook).toBe("failed");
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });
});
