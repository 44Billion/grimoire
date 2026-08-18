import { describe, expect, it, vi } from "vitest";

import { httpAuthHeader, KIND_HTTP_AUTH, signHttpAuth } from "@/lib/nip98";
import type { NostrEvent } from "@/types/nostr";

/** A signer that records what it was asked to sign and hands back a stub. */
function recordingSigner() {
  const templates: Parameters<
    Parameters<typeof signHttpAuth>[0]["signEvent"]
  >[0][] = [];
  return {
    templates,
    signEvent: vi.fn(async (template) => {
      templates.push(template);
      return {
        ...template,
        id: "a".repeat(64),
        pubkey: "b".repeat(64),
        sig: "c".repeat(128),
      } as NostrEvent;
    }),
  };
}

describe("signHttpAuth", () => {
  it("signs a kind-27235 naming the exact url and method", async () => {
    const signer = recordingSigner();
    await signHttpAuth(signer, "https://relay.example/.well-known/x", "GET");

    const [template] = signer.templates;
    expect(template.kind).toBe(KIND_HTTP_AUTH);
    expect(template.content).toBe("");
    expect(template.tags).toEqual([
      ["u", "https://relay.example/.well-known/x"],
      ["method", "GET"],
    ]);
  });

  it("defaults to GET", async () => {
    const signer = recordingSigner();
    await signHttpAuth(signer, "https://relay.example/x");
    expect(signer.templates[0].tags).toContainEqual(["method", "GET"]);
  });

  it("round-trips the signed event through base64", async () => {
    const signer = recordingSigner();
    const encoded = await signHttpAuth(signer, "https://relay.example/x");
    const decoded = JSON.parse(atob(encoded)) as NostrEvent;
    expect(decoded.kind).toBe(KIND_HTTP_AUTH);
    expect(decoded.sig).toBe("c".repeat(128));
  });

  // `btoa` throws on any code point above U+00FF, and a relay is free to name a
  // group in a script that has some.
  it("encodes a url with non-ASCII characters rather than throwing", async () => {
    const signer = recordingSigner();
    const url = "https://relay.example/.well-known/nip29/livekit/café";
    const encoded = await signHttpAuth(signer, url);
    const decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
      ),
    ) as NostrEvent;
    expect(decoded.tags).toContainEqual(["u", url]);
  });

  it("lets a refusing signer's error through", async () => {
    const signer = {
      signEvent: vi.fn(async () => {
        throw new Error("user declined");
      }),
    };
    await expect(
      signHttpAuth(signer, "https://relay.example/x"),
    ).rejects.toThrow("user declined");
  });
});

describe("httpAuthHeader", () => {
  it("uses the Nostr scheme", () => {
    expect(httpAuthHeader("abc")).toBe("Nostr abc");
  });
});
