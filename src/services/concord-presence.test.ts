/**
 * Presence over a real socket.
 *
 * Everything here is a property a pure test cannot demonstrate: that an
 * ephemeral wrap reaches a listener at all (nothing else in grimoire subscribes
 * to 21059), that the REQ is refcounted rather than one-per-watcher, that a
 * heartbeat from a foreign channel is dropped, and — the load-bearing one — that
 * none of this reaches Dexie. A stored heartbeat would outlive the call it
 * described and file itself as a chat rumor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import { voiceKeysOf } from "@/lib/concord/channels";
import {
  bytesToHex,
  channelGroupKey,
  random32,
  type GroupKey,
} from "@/lib/concord/derive";
import { KIND_SEAL_ENCRYPTED, KIND_VOICE_PRESENCE } from "@/lib/concord/kinds";
import { buildRumor, sealRumor, wrapSeal } from "@/lib/concord/stream";
import type { Channel } from "@/lib/concord/types";
import type { VoicePresenceFold } from "@/lib/concord/voice";
import {
  _liveAddressesForTests,
  _resetEphemeralForTests,
} from "@/services/concord-ephemeral";
import {
  clearVoicePresence,
  publishPresence,
  watchChannelVoice,
} from "@/services/concord-presence";
import db from "@/services/db";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

const root = random32();
const channelId = random32();
const CHANNEL = bytesToHex(channelId);
const chatKey = channelGroupKey(root, channelId, 0n);

const channel: Channel = {
  id: channelId,
  idHex: CHANNEL,
  name: "#general",
  isPrivate: false,
  streams: [{ epoch: 0n, group: chatKey }],
  current: { epoch: 0n, group: chatKey },
  voice: voiceKeysOf(root, channelId, 0n),
};

const memberSk = generateSecretKey();
const MEMBER = getPublicKey(memberSk);
const signer = {
  signEvent: async (template: Parameters<typeof finalizeEvent>[0]) =>
    finalizeEvent(template, memberSk),
};

/** A real presence wrap: 23313 rumor, encrypted seal, EPHEMERAL 21059 wrap. */
async function presenceWrap(opts: {
  status: "joined" | "left";
  identity?: string;
  broker?: string;
  sk?: Uint8Array;
  channelIdHex?: string;
  stream?: GroupKey;
  ms?: number;
}): Promise<NostrEvent> {
  const sk = opts.sk ?? memberSk;
  const stream = opts.stream ?? chatKey;
  const tags: string[][] = [
    ["channel", opts.channelIdHex ?? CHANNEL],
    ["epoch", "0"],
  ];
  if (opts.status === "joined") {
    tags.push(["identity", opts.identity ?? "PA-1"]);
    if (opts.broker) tags.push(["broker", opts.broker]);
  }
  const rumor = buildRumor({
    kind: KIND_VOICE_PRESENCE,
    content: opts.status,
    tags,
    pubkey: getPublicKey(sk),
    ms: opts.ms ?? Date.now(),
  });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, stream, {
    signEvent: async (template) => finalizeEvent(template, sk),
  });
  return wrapSeal(seal, stream, { ephemeral: true });
}

/**
 * Wait for the relay to have ACCEPTED the REQ. `_liveAddressesForTests` only
 * says the client opened one; an event pushed before the relay registered the
 * subscription is lost outright, because nothing about 21059 is stored.
 */
async function live(): Promise<void> {
  await until(() => relay.reqCount() > 0);
  await new Promise((r) => setTimeout(r, 50));
}

/** Wait until `check` holds, or fail — presence has no completion signal. */
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out waiting for presence");
}

let relay: MockRelay;

beforeEach(async () => {
  relay = await startMockRelay({ kind: "normal" });
});

afterEach(async () => {
  clearVoicePresence();
  _resetEphemeralForTests();
  await relay.close();
  vi.restoreAllMocks();
});

describe("watchChannelVoice", () => {
  it("folds a joined that arrives live on the ephemeral wrap", async () => {
    let fold: VoicePresenceFold = { present: [], claims: new Map() };
    const stop = watchChannelVoice([relay.url], channel, {
      onFold: (next) => {
        fold = next;
      },
    });
    await live();

    relay.push(
      await presenceWrap({
        status: "joined",
        identity: "PA-1",
        broker: "https://b.example",
      }),
    );
    await until(() => fold.present.length === 1);

    expect(fold.present[0]).toMatchObject({
      author: MEMBER,
      identity: "PA-1",
      broker: "https://b.example",
    });
    stop();
  });

  it("drops a member on their `left`", async () => {
    let fold: VoicePresenceFold = { present: [], claims: new Map() };
    const stop = watchChannelVoice([relay.url], channel, {
      onFold: (next) => {
        fold = next;
      },
    });
    await live();

    relay.push(await presenceWrap({ status: "joined", ms: Date.now() }));
    await until(() => fold.present.length === 1);
    relay.push(await presenceWrap({ status: "left", ms: Date.now() + 1 }));
    await until(() => fold.present.length === 0);
    stop();
  });

  it("refuses a heartbeat bound to another channel", async () => {
    // The wrap opens — it is sealed under this channel's key — but its binding
    // names a different channel, so a keyholder cannot splice one member's
    // presence into a room they never claimed.
    let folds = 0;
    let fold: VoicePresenceFold = { present: [], claims: new Map() };
    const stop = watchChannelVoice([relay.url], channel, {
      onFold: (next) => {
        folds += 1;
        fold = next;
      },
    });
    await live();

    relay.push(
      await presenceWrap({
        status: "joined",
        channelIdHex: bytesToHex(random32()),
      }),
    );
    // Give it room to be wrongly accepted.
    await new Promise((r) => setTimeout(r, 200));
    expect(fold.present).toHaveLength(0);
    expect(folds).toBe(1); // the seeded empty fold, and nothing since
    stop();
  });

  it("writes nothing to the rumor store", async () => {
    // The whole reason this bypasses `concord-wire-ingest`: an ephemeral wrap
    // filed as a rumor would outlive the call it described.
    const before = await db.concordRumors.count();
    const stop = watchChannelVoice([relay.url], channel, { onFold: () => {} });
    await live();
    relay.push(await presenceWrap({ status: "joined" }));
    await new Promise((r) => setTimeout(r, 200));
    expect(await db.concordRumors.count()).toBe(before);
    stop();
  });

  it("shares one REQ across watchers and closes it with the last", async () => {
    const first = watchChannelVoice([relay.url], channel, { onFold: () => {} });
    const second = watchChannelVoice([relay.url], channel, {
      onFold: () => {},
    });
    await live();
    const reqs = relay.reqCount();

    first();
    await new Promise((r) => setTimeout(r, 150));
    // Still one watcher: the subscription stays, and nothing was re-issued.
    expect(_liveAddressesForTests(relay.url)).toHaveLength(1);
    expect(relay.reqCount()).toBe(reqs);

    second();
    await until(() => _liveAddressesForTests(relay.url).length === 0);
  });

  it("seeds a fresh watcher from what an earlier one learned", async () => {
    // Presence is never stored, so a cold watcher would otherwise be blind for
    // a full heartbeat — which inside a call means silent tiles.
    const stop = watchChannelVoice([relay.url], channel, { onFold: () => {} });
    await live();
    relay.push(await presenceWrap({ status: "joined", identity: "PA-9" }));

    let seeded: VoicePresenceFold | undefined;
    await until(() => {
      const probe = watchChannelVoice([relay.url], channel, {
        onFold: (f) => {
          seeded ??= f;
        },
      });
      probe();
      const got = seeded?.present.length === 1;
      if (!got) seeded = undefined;
      return got;
    });
    expect(seeded?.present[0].identity).toBe("PA-9");
    stop();
  });
});

describe("publishPresence", () => {
  it("publishes an EPHEMERAL wrap the relay is not asked to store", async () => {
    await publishPresence({
      relays: [relay.url],
      channel,
      pubkey: MEMBER,
      signer,
      status: "joined",
      identity: "PA-1",
      broker: "https://b.example",
    });
    const [wrap] = relay.accepted();
    expect(wrap).toBeDefined();
    // 21059, not 1059: relays MUST NOT store it (CORD-02 Appendix B).
    expect(wrap.kind).toBe(21059);
    expect(wrap.pubkey).toBe(chatKey.pk);
  });

  it("round-trips through a watcher as our own presence", async () => {
    let fold: VoicePresenceFold = { present: [], claims: new Map() };
    const stop = watchChannelVoice([relay.url], channel, {
      onFold: (next) => {
        fold = next;
      },
    });
    await live();

    await publishPresence({
      relays: [relay.url],
      channel,
      pubkey: MEMBER,
      signer,
      status: "joined",
      identity: "PA-self",
      broker: "https://b.example",
      hand: true,
    });
    // The mock accepts an EVENT but does not fan it out to open subscriptions
    // the way a real relay does, so the echo is replayed by hand — what is
    // under test is that our own heartbeat decodes as our own presence,
    // hand included.
    relay.push(relay.accepted()[0]);
    await until(() => fold.present.length === 1);
    expect(fold.present[0]).toMatchObject({
      author: MEMBER,
      identity: "PA-self",
      hand: true,
    });
    stop();
  });
});
