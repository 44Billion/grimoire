/**
 * The repositories YOU announced — the ones you might hand an agent.
 *
 * NIP-34's kind 30617, authored by the signed-in account. Not the agent's
 * checkouts: an agent's sandbox holds whatever its operator put there, and the
 * question this answers is "which of MY projects should something work on".
 *
 * Read from the outbox, because a replaceable event lives where its author
 * publishes it and asking a random relay for someone's repositories is asking
 * the wrong place a question it may answer with a stale copy.
 */

import { useMemo } from "react";
import type { NostrEvent } from "nostr-tools";

import { useAccount } from "@/hooks/useAccount";
import { useTimeline } from "@/hooks/useTimeline";
import { useUserRelays } from "@/hooks/useUserRelays";

/** NIP-34's repository announcement. */
export const KIND_REPOSITORY = 30617;

export interface MyRepository {
  /** The `d` tag — the repository's id, unique per author. */
  id: string;
  name: string;
  description?: string;
  /** Where it can be cloned from. First one wins; the rest are mirrors. */
  clone?: string;
  /** A human-readable page, when the author gave one. */
  web?: string;
  /** `30617:<pubkey>:<d>` — how anything else refers to it. */
  address: string;
  event: NostrEvent;
}

function repositoryOf(event: NostrEvent): MyRepository | null {
  const value = (name: string) =>
    event.tags.find((tag) => tag[0] === name && tag[1])?.[1];
  const id = value("d");
  if (!id) return null;

  return {
    id,
    // A repository with no `name` is named by its id, which is what a `d` tag
    // is for — better than "untitled" for something the author has to pick
    // out of a list.
    name: value("name") ?? id,
    description: value("description"),
    // NIP-34 puts every clone URL on ONE tag, space-separated after the name.
    clone: event.tags.find((tag) => tag[0] === "clone")?.[1],
    web: event.tags.find((tag) => tag[0] === "web")?.[1],
    address: `${KIND_REPOSITORY}:${event.pubkey}:${id}`,
    event,
  };
}

export function useMyRepositories(): {
  repositories: MyRepository[];
  loading: boolean;
} {
  const { pubkey } = useAccount();
  const { outboxRelays } = useUserRelays(pubkey ?? undefined);

  const { events, loading } = useTimeline(
    `my-repositories:${pubkey ?? "anon"}`,
    pubkey ? { kinds: [KIND_REPOSITORY], authors: [pubkey] } : { kinds: [] },
    outboxRelays ?? [],
    { limit: 100 },
  );

  const repositories = useMemo(() => {
    if (!pubkey) return [];
    const newest = new Map<string, NostrEvent>();
    for (const event of events) {
      // Replaceable: one row per `d`, and the newest wins. A relay that still
      // serves a superseded copy would otherwise offer a repository twice,
      // under two names, both of them clickable.
      const id = event.tags.find((tag) => tag[0] === "d" && tag[1])?.[1];
      if (!id) continue;
      const held = newest.get(id);
      if (!held || event.created_at > held.created_at) newest.set(id, event);
    }
    return [...newest.values()]
      .map(repositoryOf)
      .filter((repo): repo is MyRepository => repo !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [events, pubkey]);

  return { repositories, loading };
}
