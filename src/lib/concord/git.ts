/**
 * Git repositories attached to a Channel — the read side of armada's
 * `armada.git` channel-metadata extension.
 *
 * Ported from armada `bc19d1f` (`src/concord-v2/lib/types.ts`), read paths only.
 * Grimoire publishes nothing to the Control Plane, so the attach/detach writers
 * are deliberately absent: armada owns the arrangement, grimoire honours it.
 *
 * Like `armada.order`/`armada.category` this is a CLIENT CONVENTION, not CORD:
 * a channel carries no repository field in the protocol, so the intervals ride
 * in `custom`. Malformed extension data is ignored rather than invalidating the
 * channel it hangs off.
 */

import type { ChannelMetadata } from "@/lib/concord/types";

/** NIP-34 repository announcement. */
export const GIT_REPOSITORY_ANNOUNCEMENT_KIND = 30617;

export const ARMADA_GIT_CHANNEL_METADATA_KEY = "armada.git";
/** Hostile-metadata bounds: armada writes within both. */
export const MAX_CHANNEL_GIT_ATTACHMENTS = 128;
export const MAX_CHANNEL_GIT_RELAY_HINTS = 8;

/** A validated NIP-34 repository coordinate. */
export interface GitRepositoryAddress {
  kind: typeof GIT_REPOSITORY_ANNOUNCEMENT_KIND;
  owner: string;
  identifier: string;
  coordinate: string;
}

/**
 * One attachment interval: a repository is attached at a time and possibly
 * detached later, so a message's git context is the attachment that was live
 * when it was written rather than whatever is attached now.
 */
export interface GitRepositoryAttachment {
  address: GitRepositoryAddress;
  relayHints: string[];
  attachedAt: number;
  detachedAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parse a canonical `30617:<owner-pubkey>:<d>` coordinate. */
export function parseGitRepositoryAddress(
  value: unknown,
): GitRepositoryAddress | undefined {
  if (typeof value !== "string") return undefined;
  const [kind, owner, ...rest] = value.split(":");
  const identifier = rest.join(":").trim();
  if (Number(kind) !== GIT_REPOSITORY_ANNOUNCEMENT_KIND || !identifier)
    return undefined;
  if (!owner || !/^[0-9a-f]{64}$/.test(owner)) return undefined;
  return {
    kind: GIT_REPOSITORY_ANNOUNCEMENT_KIND,
    owner,
    identifier,
    coordinate: `${GIT_REPOSITORY_ANNOUNCEMENT_KIND}:${owner}:${identifier}`,
  };
}

/** True when an event timestamp falls within an attachment's half-open interval. */
export function isGitRepositoryAttachedAt(
  attachment: GitRepositoryAttachment,
  createdAt: number,
): boolean {
  return (
    attachment.attachedAt <= createdAt &&
    (attachment.detachedAt === undefined || createdAt < attachment.detachedAt)
  );
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Every attachment interval a channel carries, oldest first — the order armada
 * normalizes to, kept so a walk over history reads forward.
 */
export function channelGitRepositories(
  metadata: ChannelMetadata,
): GitRepositoryAttachment[] {
  const extension = isRecord(metadata.custom)
    ? metadata.custom[ARMADA_GIT_CHANNEL_METADATA_KEY]
    : undefined;
  if (!isRecord(extension) || !Array.isArray(extension.repositories)) return [];

  const attachments: GitRepositoryAttachment[] = [];
  for (const value of extension.repositories) {
    if (!isRecord(value)) continue;
    const address = parseGitRepositoryAddress(value.address);
    if (!address || !isTimestamp(value.attachedAt)) continue;
    const detachedAt = value.detachedAt;
    if (
      detachedAt !== undefined &&
      (!isTimestamp(detachedAt) || detachedAt < value.attachedAt)
    ) {
      continue;
    }
    attachments.push({
      address,
      relayHints: (Array.isArray(value.relayHints) ? value.relayHints : [])
        .filter(
          (relay): relay is string => typeof relay === "string" && !!relay,
        )
        .slice(0, MAX_CHANNEL_GIT_RELAY_HINTS),
      attachedAt: value.attachedAt,
      ...(detachedAt === undefined ? {} : { detachedAt }),
    });
  }

  const seen = new Set<string>();
  return attachments
    .sort(
      (a, b) =>
        a.attachedAt - b.attachedAt ||
        a.address.coordinate.localeCompare(b.address.coordinate),
    )
    .filter((attachment) => {
      const key = [
        attachment.address.coordinate,
        attachment.attachedAt,
        attachment.detachedAt ?? "",
      ].join("/");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CHANNEL_GIT_ATTACHMENTS);
}

/**
 * The repositories attached RIGHT NOW, newest attachment first — what a header
 * names. Reading `channelGitRepositories()[0]` instead would name the OLDEST
 * interval, a detached one included.
 */
export function activeGitRepositories(
  metadata: ChannelMetadata,
): GitRepositoryAttachment[] {
  return channelGitRepositories(metadata)
    .filter((attachment) => attachment.detachedAt === undefined)
    .reverse();
}
