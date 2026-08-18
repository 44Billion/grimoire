import { describe, expect, it } from "vitest";

import {
  activeGitRepositories,
  channelGitRepositories,
  isGitRepositoryAttachedAt,
  parseGitRepositoryAddress,
  MAX_CHANNEL_GIT_ATTACHMENTS,
  MAX_CHANNEL_GIT_RELAY_HINTS,
} from "@/lib/concord/git";
import type { ChannelMetadata } from "@/lib/concord/types";

const OWNER =
  "7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194";
const COORD = `30617:${OWNER}:grimoire`;

function metadata(repositories: unknown, extra?: Record<string, unknown>) {
  return {
    name: "grimoire",
    private: false,
    custom: { "armada.git": { repositories }, ...extra },
  } satisfies ChannelMetadata;
}

describe("parseGitRepositoryAddress", () => {
  it("accepts a canonical coordinate", () => {
    expect(parseGitRepositoryAddress(COORD)).toEqual({
      kind: 30617,
      owner: OWNER,
      identifier: "grimoire",
      coordinate: COORD,
    });
  });

  it("rejects a wrong kind, a bad owner, an empty identifier, a non-string", () => {
    expect(
      parseGitRepositoryAddress(`30618:${OWNER}:grimoire`),
    ).toBeUndefined();
    expect(parseGitRepositoryAddress(`30617:${OWNER.toUpperCase()}:g`)).toBe(
      undefined,
    );
    expect(parseGitRepositoryAddress(`30617:nothex:grimoire`)).toBeUndefined();
    expect(parseGitRepositoryAddress(`30617:${OWNER}:`)).toBeUndefined();
    expect(parseGitRepositoryAddress(42)).toBeUndefined();
  });
});

describe("channelGitRepositories", () => {
  it("reads an attachment with its relay hints", () => {
    const got = channelGitRepositories(
      metadata([
        { address: COORD, relayHints: ["wss://relay.ngit.dev"], attachedAt: 5 },
      ]),
    );
    expect(got).toHaveLength(1);
    expect(got[0].address.coordinate).toBe(COORD);
    expect(got[0].relayHints).toEqual(["wss://relay.ngit.dev"]);
    expect(got[0].detachedAt).toBeUndefined();
  });

  it("is empty for a channel with no extension, and for a malformed one", () => {
    expect(channelGitRepositories({ name: "x", private: false })).toEqual([]);
    expect(channelGitRepositories(metadata("not-an-array"))).toEqual([]);
    expect(
      channelGitRepositories({
        name: "x",
        private: false,
        custom: { "armada.git": 7 },
      }),
    ).toEqual([]);
  });

  it("skips malformed entries without dropping the good ones", () => {
    const got = channelGitRepositories(
      metadata([
        { address: "nonsense", relayHints: [], attachedAt: 1 },
        { address: COORD, relayHints: [], attachedAt: 1.5 },
        { address: COORD, relayHints: [], attachedAt: -1 },
        { address: COORD, relayHints: [], attachedAt: 10, detachedAt: 9 },
        { address: COORD, relayHints: [], attachedAt: 10, detachedAt: "later" },
        "not-an-object",
        { address: COORD, relayHints: [], attachedAt: 7 },
      ]),
    );
    expect(got.map((a) => a.attachedAt)).toEqual([7]);
  });

  it("keeps entries whose relayHints are absent or partly junk", () => {
    const got = channelGitRepositories(
      metadata([
        { address: COORD, attachedAt: 1 },
        {
          address: `30617:${OWNER}:other`,
          relayHints: ["wss://a", 3, "", null],
          attachedAt: 2,
        },
      ]),
    );
    expect(got.map((a) => a.relayHints)).toEqual([[], ["wss://a"]]);
  });

  it("orders oldest first and drops duplicate intervals", () => {
    const got = channelGitRepositories(
      metadata([
        { address: COORD, relayHints: [], attachedAt: 30 },
        { address: COORD, relayHints: [], attachedAt: 10, detachedAt: 20 },
        { address: COORD, relayHints: [], attachedAt: 10, detachedAt: 20 },
      ]),
    );
    expect(got.map((a) => [a.attachedAt, a.detachedAt])).toEqual([
      [10, 20],
      [30, undefined],
    ]);
  });

  it("bounds relay hints and attachment count", () => {
    const hints = Array.from({ length: 20 }, (_, i) => `wss://r${i}`);
    const many = Array.from(
      { length: MAX_CHANNEL_GIT_ATTACHMENTS + 5 },
      (_, i) => ({
        address: `30617:${OWNER}:repo${i}`,
        relayHints: hints,
        attachedAt: i + 1,
      }),
    );
    const got = channelGitRepositories(metadata(many));
    expect(got).toHaveLength(MAX_CHANNEL_GIT_ATTACHMENTS);
    expect(got[0].relayHints).toHaveLength(MAX_CHANNEL_GIT_RELAY_HINTS);
  });
});

describe("activeGitRepositories", () => {
  it("returns only live attachments, newest first", () => {
    const got = activeGitRepositories(
      metadata([
        {
          address: `30617:${OWNER}:old`,
          relayHints: [],
          attachedAt: 1,
          detachedAt: 2,
        },
        { address: `30617:${OWNER}:first`, relayHints: [], attachedAt: 3 },
        { address: `30617:${OWNER}:latest`, relayHints: [], attachedAt: 9 },
      ]),
    );
    expect(got.map((a) => a.address.identifier)).toEqual(["latest", "first"]);
  });
});

describe("isGitRepositoryAttachedAt", () => {
  const attachment = {
    address: parseGitRepositoryAddress(COORD)!,
    relayHints: [],
    attachedAt: 10,
    detachedAt: 20,
  };

  it("is a half-open interval", () => {
    expect(isGitRepositoryAttachedAt(attachment, 9)).toBe(false);
    expect(isGitRepositoryAttachedAt(attachment, 10)).toBe(true);
    expect(isGitRepositoryAttachedAt(attachment, 19)).toBe(true);
    expect(isGitRepositoryAttachedAt(attachment, 20)).toBe(false);
  });

  it("runs forever while undetached", () => {
    const { detachedAt: _detached, ...live } = attachment;
    expect(isGitRepositoryAttachedAt(live, 1_000_000)).toBe(true);
  });
});
