import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  kinds,
} from "nostr-tools";
import { nip04 } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import db from "./db";
import {
  listDmConversations,
  queryConversation,
  toLegacyDmRow,
} from "./dm-store";
import { ingestLegacyDms, legacyCounterparty } from "./dm-legacy-inbox";

/**
 * A kind 4 is a PUBLIC event that happens to hold ciphertext. Nothing wraps it
 * and nothing vouches for it but its own signature — which is why the vetting
 * here is a security boundary rather than a formality, and why every test in
 * this file is about what must NOT get in.
 */

const aliceKey = generateSecretKey();
const bobKey = generateSecretKey();
const ALICE = getPublicKey(aliceKey);
const BOB = getPublicKey(bobKey);

/** A signer that can open a legacy message, as the ingest expects one. */
const alice = {
  nip04: {
    decrypt: async (pubkey: string, ciphertext: string) =>
      nip04.decrypt(aliceKey, pubkey, ciphertext),
  },
};

/** A real kind 4 from `fromKey` to `to`, signed. */
async function legacyMessage(
  fromKey: Uint8Array,
  to: string,
  content: string,
  created_at = Math.floor(Date.now() / 1000) - 100,
): Promise<NostrEvent> {
  return finalizeEvent(
    {
      kind: kinds.EncryptedDirectMessage,
      created_at,
      tags: [["p", to]],
      content: await nip04.encrypt(fromKey, to, content),
    },
    fromKey,
  );
}

beforeEach(async () => {
  await db.dmRumors.clear();
  await db.dmConversations.clear();
  await db.dmSeenWraps.clear();
  await db.dmKv.clear();
});

describe("toLegacyDmRow", () => {
  it("refuses an event whose signature does not verify", async () => {
    // The whole basis for trusting the row. A rumor is vouched for by the seal
    // around it; a kind 4 has nothing around it, so a forged one would
    // otherwise walk straight into the conversation it names.
    const real = await legacyMessage(bobKey, ALICE, "genuine");
    const forged = { ...real, content: "tampered" } as NostrEvent;

    expect(toLegacyDmRow(ALICE, forged, "tampered")).toEqual({
      rejected: "signature does not verify",
    });
  });

  it("keeps the signed event's own id rather than rehashing the plaintext", async () => {
    // The id was hashed over the CIPHERTEXT, so recomputing it from what the
    // row now holds would reject every legitimate message.
    const event = await legacyMessage(bobKey, ALICE, "hello");
    const row = toLegacyDmRow(ALICE, event, "hello");

    expect("rejected" in row).toBe(false);
    expect((row as { id: string }).id).toBe(event.id);
  });

  it("marks the row legacy, so nothing claims it was gift-wrapped", async () => {
    const event = await legacyMessage(bobKey, ALICE, "hello");
    expect(toLegacyDmRow(ALICE, event, "hello")).toMatchObject({
      legacy: true,
    });
  });

  it("refuses a kind-4 rumor that arrived inside a gift wrap", async () => {
    // The hole this closes. Keying "legacy" off the KIND alone meant anyone
    // could put a kind 4 inside a gift wrap — a wrap carries whatever its
    // author chose — and it would take the legacy branch, skipping the id
    // recompute that every gift-wrapped rumor depends on for its identity.
    // Only the signature-verified path may claim the exemption.
    const { toDmRow } = await import("./dm-store");
    const event = await legacyMessage(bobKey, ALICE, "hello");

    expect(
      toDmRow(ALICE, { ...event, content: "anything at all" } as never),
    ).toEqual({
      rejected: "legacy message did not come from a verified event",
    });
  });

  it("refuses a kind that is not a legacy message", async () => {
    const event = await legacyMessage(bobKey, ALICE, "hello");
    expect(toLegacyDmRow(ALICE, { ...event, kind: 1 }, "hello")).toMatchObject({
      rejected: expect.stringContaining("not a legacy direct message"),
    });
  });
});

describe("legacyCounterparty", () => {
  it("is the author of a message we received", async () => {
    const event = await legacyMessage(bobKey, ALICE, "hi");
    expect(legacyCounterparty(event, ALICE)).toBe(BOB);
  });

  it("is the recipient of a message we sent", async () => {
    const event = await legacyMessage(aliceKey, BOB, "hi");
    expect(legacyCounterparty(event, ALICE)).toBe(BOB);
  });

  it("is nobody for a message we sent to no one", async () => {
    const event = await legacyMessage(aliceKey, BOB, "hi");
    expect(legacyCounterparty({ ...event, tags: [] }, ALICE)).toBeUndefined();
  });
});

describe("ingestLegacyDms", () => {
  it("stores a decrypted legacy message", async () => {
    const event = await legacyMessage(bobKey, ALICE, "from the old days");

    const outcome = await ingestLegacyDms(ALICE, alice, [event]);

    expect(outcome).toMatchObject({ written: 1, failed: 0 });
    const [conversation] = await listDmConversations(ALICE);
    const rows = await queryConversation(ALICE, conversation.conversationId, {
      limit: 10,
    });
    expect(rows[0].content).toBe("from the old days");
    expect(rows[0].legacy).toBe(true);
  });

  it("files it in the SAME conversation as a gift-wrapped message", async () => {
    // The point of the whole exercise: a kind-4 exchange with someone is the
    // same human conversation as the NIP-17 one, so it belongs in one thread.
    const { WrappedMessageFactory } =
      await import("applesauce-common/factories");
    const { PrivateKeySigner } = await import("applesauce-signers");
    const bobSigner = PrivateKeySigner.fromKey(bobKey);
    const rumor = await WrappedMessageFactory.create([ALICE], "the new way")
      .as(bobSigner)
      .stamp();
    const { getEventHash } = await import("nostr-tools");
    const { writeDmRumors } = await import("./dm-store");
    await writeDmRumors(ALICE, [{ ...rumor, id: getEventHash(rumor) }]);

    await ingestLegacyDms(ALICE, alice, [
      await legacyMessage(bobKey, ALICE, "the old way"),
    ]);

    const conversations = await listDmConversations(ALICE);
    expect(conversations).toHaveLength(1);
    const rows = await queryConversation(
      ALICE,
      conversations[0].conversationId,
      {
        limit: 10,
      },
    );
    expect(rows.map((r) => r.content).sort()).toEqual([
      "the new way",
      "the old way",
    ]);
  });

  it("never asks the signer twice for the same message", async () => {
    const event = await legacyMessage(bobKey, ALICE, "once");
    await ingestLegacyDms(ALICE, alice, [event]);

    const decrypt = vi.spyOn(alice.nip04, "decrypt");
    const outcome = await ingestLegacyDms(ALICE, alice, [event]);

    expect(decrypt).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ written: 0 });
    decrypt.mockRestore();
  });

  it("does nothing at all without a nip04 signer", async () => {
    const event = await legacyMessage(bobKey, ALICE, "hello");
    expect(await ingestLegacyDms(ALICE, {}, [event])).toMatchObject({
      written: 0,
    });
    expect(await db.dmRumors.count()).toBe(0);
  });

  it("ignores anything that is not a kind 4", async () => {
    const event = await legacyMessage(bobKey, ALICE, "hello");
    const outcome = await ingestLegacyDms(ALICE, alice, [
      { ...event, kind: 1 } as NostrEvent,
    ]);
    expect(outcome).toMatchObject({ written: 0, failed: 0 });
  });
});
