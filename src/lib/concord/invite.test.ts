import { describe, expect, it } from "vitest";
import { nip19, nip44 } from "nostr-tools";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools/pure";

import {
  bytesToHex,
  communityIdOf,
  hex32,
  inviteBundleKey,
  random32,
} from "./derive";
import {
  KIND_DIRECT_INVITE,
  KIND_INVITE_BUNDLE,
  VSK_INVITE_LIVE,
  VSK_INVITE_REVOKED,
} from "./kinds";
import {
  decodeFragment,
  InviteError,
  inviteStanding,
  parseBundleEvent,
  parseInviteLink,
  STOCK_RELAYS,
  validateBundle,
  type InviteBundle,
} from "./invite";
import { parseDirectInviteRumor } from "./direct-invite";
import { entryFromBundle, joinTags, serializeCommunityList } from "./join";

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

/** Encode a fragment the way a minting client does (CORD-05 §3). */
function fragmentOf(token: Uint8Array, stock = true): string {
  const bytes = stock
    ? [4, 0x01, ...token]
    : [
        4,
        0x00,
        1,
        0,
        "relay.example".length,
        ...new TextEncoder().encode("relay.example"),
        ...token,
      ];
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("validateBundle", () => {
  it("refuses a bundle whose owner does not reproduce its community_id", () => {
    // The whole trust model: a compromised creator cannot smuggle a false
    // owner or a fake key for a real community.
    const forged = bundleOf({ owner: getPublicKey(generateSecretKey()) });
    expect(() => validateBundle(forged)).toThrow(InviteError);
  });

  it("bounds an attacker-crafted channel list before allocating", () => {
    const flood = bundleOf({
      channels: Array.from({ length: 257 }, () => ({
        id: bytesToHex(random32()),
        key: bytesToHex(random32()),
        epoch: 0,
        name: "c",
      })),
    });
    expect(() => validateBundle(flood)).toThrow(/cap 256/);
  });

  it("truncates a hostile relay list to the community cap", () => {
    const many = bundleOf({
      relays: Array.from({ length: 40 }, (_, i) => `wss://r${i}.example`),
    });
    expect(validateBundle(many).relays.length).toBeLessThanOrEqual(5);
  });
});

describe("the fragment codec", () => {
  it("reads the stock set from a single flag bit", () => {
    const token = random32().slice(0, 16);
    const decoded = decodeFragment(fragmentOf(token));
    expect(decoded.relays).toEqual(STOCK_RELAYS);
    expect(bytesToHex(decoded.token)).toBe(bytesToHex(token));
  });

  it("reads a wss-implied literal relay", () => {
    const token = random32().slice(0, 16);
    const decoded = decodeFragment(fragmentOf(token, false));
    expect(decoded.relays).toEqual(["wss://relay.example"]);
  });

  it("refuses a legacy generation rather than decoding it wrong", () => {
    // A lower version selects a different dictionary; decoding against this
    // one would point the fetch at the wrong relays entirely.
    const bin = String.fromCharCode(3, 0x01, ...new Uint8Array(16));
    const older = btoa(bin)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(() => decodeFragment(older)).toThrow(/older link format/);
  });

  it("refuses trailing bytes", () => {
    const token = random32().slice(0, 16);
    expect(() => decodeFragment(fragmentOf(token) + "AA")).toThrow(InviteError);
  });
});

describe("parseInviteLink", () => {
  const linkSigner = getPublicKey(generateSecretKey());
  const naddr = nip19.naddrEncode({
    kind: KIND_INVITE_BUNDLE,
    pubkey: linkSigner,
    identifier: "",
  });
  const fragment = fragmentOf(random32().slice(0, 16));

  it("parses a full URL and the bare form alike — the base is cosmetic", () => {
    for (const input of [
      `https://vectorapp.io/invite/${naddr}#${fragment}`,
      `https://armada.buzz/invite/${naddr}#${fragment}`,
      `${naddr}#${fragment}`,
    ]) {
      expect(parseInviteLink(input)?.linkSigner).toBe(linkSigner);
    }
  });

  it("is undefined for anything that is not an invite", () => {
    expect(parseInviteLink("https://example.com/hello")).toBeUndefined();
    expect(parseInviteLink("not a url")).toBeUndefined();
    // An naddr for another kind is not a bundle coordinate.
    const other = nip19.naddrEncode({
      kind: 30023,
      pubkey: linkSigner,
      identifier: "",
    });
    expect(parseInviteLink(`${other}#${fragment}`)).toBeUndefined();
  });
});

describe("parseBundleEvent", () => {
  const linkSk = generateSecretKey();
  const linkSigner = getPublicKey(linkSk);
  const token = random32().slice(0, 16);

  const event = (bundle: InviteBundle, vsk = VSK_INVITE_LIVE): NostrEvent =>
    finalizeEvent(
      {
        kind: KIND_INVITE_BUNDLE,
        content:
          vsk === VSK_INVITE_LIVE
            ? nip44.encrypt(JSON.stringify(bundle), inviteBundleKey(token))
            : "",
        tags: [
          ["d", ""],
          ["vsk", vsk],
        ],
        created_at: 1_700_000_000,
      },
      linkSk,
    ) as NostrEvent;

  it("decrypts a live bundle at its own coordinate", () => {
    const parsed = parseBundleEvent(event(bundleOf()), linkSigner, token);
    expect(parsed.name).toBe("Test");
  });

  it("reports a revocation tombstone as revoked, not as garbage", () => {
    expect(() =>
      parseBundleEvent(
        event(bundleOf(), VSK_INVITE_REVOKED),
        linkSigner,
        token,
      ),
    ).toThrow(/revoked/);
  });

  it("refuses an event from another author at that coordinate", () => {
    expect(() =>
      parseBundleEvent(
        event(bundleOf()),
        getPublicKey(generateSecretKey()),
        token,
      ),
    ).toThrow(/not a valid invite bundle/);
  });
});

describe("parseDirectInviteRumor", () => {
  it("takes the rumor's kind as the authority", () => {
    const bundle = bundleOf();
    expect(
      parseDirectInviteRumor(KIND_DIRECT_INVITE, JSON.stringify(bundle))?.name,
    ).toBe("Test");
    // A wrap's outer `k` tag can lie; the rumor's kind cannot.
    expect(parseDirectInviteRumor(9, JSON.stringify(bundle))).toBeUndefined();
  });

  it("drops a bundle whose owner does not check out", () => {
    const forged = bundleOf({ owner_salt: bytesToHex(random32()) });
    expect(
      parseDirectInviteRumor(KIND_DIRECT_INVITE, JSON.stringify(forged)),
    ).toBeUndefined();
  });
});

describe("entryFromBundle", () => {
  it("keeps the membership subset and drops the link's own fields", () => {
    const bundle = bundleOf({
      icon: { url: "u", key: "k", nonce: "n", hash: "h" },
      expires_at: 123,
      creator_npub: "ab".repeat(32),
      label: "Reddit",
    });
    const entry = entryFromBundle(bundle, 5000);
    expect(entry.current.name).toBe("Test");
    expect(entry.added_at).toBe(5000);
    // Never the icon (a device folds it from the Control Plane), never the
    // link fields — expiry and attribution belong to the invite.
    expect(entry.current.icon).toBeUndefined();
    expect(entry.current.expires_at).toBeUndefined();
    expect(entry.current.creator_npub).toBeUndefined();
    // At a join the two anchors are the same snapshot; they diverge later.
    expect(entry.seed).toEqual(entry.current);
  });
});

describe("joinTags", () => {
  it("echoes the invite's attribution, which is what counts a link's uses", () => {
    const creator = "ab".repeat(32);
    expect(
      joinTags(bundleOf({ creator_npub: creator, label: "Reddit" })),
    ).toEqual([["invite", creator, "Reddit"]]);
  });

  it("is empty when the bundle names no creator", () => {
    expect(joinTags(bundleOf())).toEqual([]);
    expect(joinTags(bundleOf({ creator_npub: "nonsense" }))).toEqual([]);
  });
});

describe("serializeCommunityList", () => {
  const entry = entryFromBundle(bundleOf());
  const list = { entries: [entry], tombstones: [] };

  it("writes the retired generation in hex, as its readers expect", () => {
    const json = JSON.parse(serializeCommunityList(list, "hex"));
    expect(json.entries[0].current.community_root).toBe(
      entry.current.community_root,
    );
  });

  it("writes the fragmented generation in unpadded base64url (§8)", () => {
    const json = JSON.parse(serializeCommunityList(list, "base64url"));
    const root = json.entries[0].current.community_root;
    expect(root).toHaveLength(43);
    expect(root).not.toContain("=");
    // …and it is the same 32 bytes, not a different value.
    const bin = atob(root.replace(/-/g, "+").replace(/_/g, "/") + "=");
    let hex = "";
    for (let i = 0; i < bin.length; i++) {
      hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
    }
    expect(hex).toBe(entry.current.community_root);
  });

  it("never touches a field it does not know", () => {
    // §8: an unknown field keeps its author's encoding verbatim — nothing here
    // can tell key material from any other string.
    const withUnknown = {
      entries: [{ ...entry, future_key: "ab".repeat(32) }],
      tombstones: [],
      some_future_flag: true,
    };
    const json = JSON.parse(serializeCommunityList(withUnknown, "base64url"));
    expect(json.entries[0].future_key).toBe("ab".repeat(32));
    expect(json.some_future_flag).toBe(true);
  });
});

describe("inviteStanding", () => {
  const heldOf = (epoch: number, channels: Array<[string, number]> = []) => ({
    rootEpoch: BigInt(epoch),
    privateChannels: channels.map(([id, ep]) => ({
      id: hex32(id),
      epoch: BigInt(ep),
    })),
  });

  it("is new when the vault does not hold the community", () => {
    expect(inviteStanding(bundleOf(), undefined, bytesToHex)).toBe("new");
  });

  it("is held when the bundle carries nothing the member lacks", () => {
    expect(inviteStanding(bundleOf(), heldOf(0), bytesToHex)).toBe("held");
  });

  it("is a catch-up at a fresher root epoch — the stranded-member heal", () => {
    const fresher = bundleOf({ root_epoch: 3 });
    expect(inviteStanding(fresher, heldOf(1), bytesToHex)).toBe("catch-up");
  });

  it("is a catch-up when it grants a channel key not held", () => {
    const granted = bundleOf({
      channels: [
        { id: "aa".repeat(32), key: "11".repeat(32), epoch: 0, name: "c" },
      ],
    });
    expect(inviteStanding(granted, heldOf(0), bytesToHex)).toBe("catch-up");
    // …and held once that key is in hand at the same epoch.
    expect(
      inviteStanding(granted, heldOf(0, [["aa".repeat(32), 0]]), bytesToHex),
    ).toBe("held");
    // A newer channel epoch is a rotation the member has not caught up with.
    expect(
      inviteStanding(
        bundleOf({
          channels: [
            { id: "aa".repeat(32), key: "22".repeat(32), epoch: 2, name: "c" },
          ],
        }),
        heldOf(0, [["aa".repeat(32), 1]]),
        bytesToHex,
      ),
    ).toBe("catch-up");
  });

  it("never treats a stale bundle as a catch-up, whatever it names", () => {
    const stale = bundleOf({
      root_epoch: 1,
      channels: [
        { id: "aa".repeat(32), key: "11".repeat(32), epoch: 0, name: "c" },
      ],
    });
    expect(inviteStanding(stale, heldOf(4), bytesToHex)).toBe("held");
  });
});
