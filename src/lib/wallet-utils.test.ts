import { describe, expect, it } from "vitest";
import { parseZapRequest } from "./wallet-utils";

const ZAPPER = "a".repeat(64);
const EVENT_ID = "b".repeat(64);

const zapRequest = {
  kind: 9734,
  pubkey: ZAPPER,
  content: "great post",
  tags: [
    ["p", "c".repeat(64)],
    ["e", EVENT_ID],
  ],
  created_at: 1700000000,
  id: "d".repeat(64),
  sig: "e".repeat(128),
};

describe("parseZapRequest", () => {
  it("reads a zap request from the transaction description", () => {
    const info = parseZapRequest({ description: JSON.stringify(zapRequest) });
    expect(info?.sender).toBe(ZAPPER);
    expect(info?.message).toBe("great post");
    expect(info?.zappedEventId).toBe(EVENT_ID);
    expect(info?.recipient).toBe("c".repeat(64));
  });

  it("reads a full zap request object from metadata.nostr", () => {
    const info = parseZapRequest({ metadata: { nostr: zapRequest } });
    expect(info?.sender).toBe(ZAPPER);
    expect(info?.message).toBe("great post");
    expect(info?.zappedEventId).toBe(EVENT_ID);
  });

  it("reads a partial metadata.nostr with the message in metadata.comment", () => {
    const info = parseZapRequest({
      metadata: {
        nostr: { pubkey: ZAPPER, tags: [["e", EVENT_ID]] },
        comment: "hi",
      },
    });
    expect(info?.sender).toBe(ZAPPER);
    expect(info?.message).toBe("hi");
    expect(info?.zappedEventId).toBe(EVENT_ID);
    expect(info?.zapRequestEvent.tags).toEqual([["e", EVENT_ID]]);
  });

  it("normalizes a metadata zap request without tags", () => {
    const info = parseZapRequest({ metadata: { nostr: { pubkey: ZAPPER } } });
    expect(info?.sender).toBe(ZAPPER);
    expect(info?.message).toBe("");
    expect(info?.zapRequestEvent.tags).toEqual([]);
  });

  it("reads a JSON-string zap request from metadata.zap_request", () => {
    const info = parseZapRequest({
      metadata: { zap_request: JSON.stringify(zapRequest) },
    });
    expect(info?.sender).toBe(ZAPPER);
  });

  it("ignores metadata objects of another kind", () => {
    expect(
      parseZapRequest({ metadata: { nostr: { ...zapRequest, kind: 1 } } }),
    ).toBeNull();
  });

  it("returns null for ordinary payments", () => {
    expect(
      parseZapRequest({ description: "coffee", metadata: { foo: 1 } }),
    ).toBeNull();
  });
});
