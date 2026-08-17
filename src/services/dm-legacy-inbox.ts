/**
 * Reading this account's legacy NIP-04 direct messages.
 *
 * NIP-17 is new — most clients shipped it in 2026 — and a kind-4 exchange with
 * someone is the same human conversation as the NIP-17 one with them. So these
 * land in the same `dmRumors` table under the same conversation id, and the
 * timeline shows one thread rather than two. What differs is what the row
 * carries: `legacy: true`, because a kind 4 is a PUBLIC event whose author,
 * recipient and timing every relay that carried it could read.
 *
 * Three things separate this from the gift-wrap path:
 *
 * - **Two filters, not one.** A kind 4 is addressed with a `p` tag and signed
 *   by its author, so your side of a conversation and theirs are two different
 *   queries: `{authors:[self]}` for what you sent, `{"#p":[self]}` for what you
 *   received. A gift-wrap inbox needs only the second because the self-copy is
 *   p-tagged to you.
 * - **Received messages are scoped to people you follow.** The kind-4 era has
 *   no gift wrap hiding who may write to you, and an unscoped read imports
 *   every piece of spam ever addressed at your key. Armada scopes it at the
 *   relay for the same reason. The cost is honest and worth stating: a legacy
 *   message from someone you do not follow is not imported.
 * - **One decrypt per message, not two.** No wrap, no seal — just
 *   `nip04.decrypt` against the counterparty. Still a signer round trip each,
 *   so the same wave-and-yield discipline applies.
 *
 * Read-only. Grimoire does not send kind 4: a new message that leaks who you
 * are talking to and when, when the recipient can receive a gift wrap, is a
 * downgrade nobody asked for.
 */

import { kinds } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { requestEvents } from "@/lib/relay-subscription";
import eventStore from "./event-store";
import { ownDmReadRelays } from "@/lib/dm/relays";
import { authenticateDmRelays } from "./dm-read-auth";
import type { DmRumorRow } from "./db";
import {
  markWrapsSeen,
  readDmKv,
  seenWrapIds,
  toLegacyDmRow,
  writeDmKv,
  writeDmRow,
} from "./dm-store";
import { DM_LIST_SCOPE, conversationScope, emitDmScopes } from "./dm-bus";

/** Messages per page, per direction. */
export const LEGACY_PAGE = 200;

/** Decrypts in flight at once, with a yield between waves. */
const DECRYPT_WAVE = 4;

const importedKey = (viewer: string) => `${viewer}:legacy-imported`;

/** A signer that can open a legacy message. Absent `nip04` means it cannot. */
export interface LegacySigner {
  nip04?: {
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

/** Whether the one-time legacy import has run for this account. */
export async function hasImportedLegacyDms(viewer: string): Promise<boolean> {
  return (await readDmKv<boolean>(importedKey(viewer))) === true;
}

/** Run it again — the escape hatch, alongside the gift-wrap rescan. */
export async function resetLegacyImport(viewer: string): Promise<void> {
  await writeDmKv(importedKey(viewer), undefined);
}

/** The other party to a kind 4: its author, or its first `p` tag if we wrote it. */
export function legacyCounterparty(
  event: NostrEvent,
  viewer: string,
): string | undefined {
  if (event.pubkey !== viewer) return event.pubkey;
  return event.tags.find((t) => t[0] === "p" && t[1])?.[1];
}

export interface LegacyImportProgress {
  fetched: number;
  written: number;
  failed: number;
  /** The walk reached the beginning of what the relays hold. */
  exhausted: boolean;
}

/**
 * Open a page of legacy messages and store what comes out.
 *
 * Exported for the tests: the vetting is a security boundary — a kind 4 is
 * only as trustworthy as its signature — and it deserves to be asserted
 * directly rather than through a relay.
 */
export async function ingestLegacyDms(
  viewer: string,
  signer: LegacySigner,
  events: NostrEvent[],
): Promise<{ written: number; failed: number }> {
  if (!signer.nip04) return { written: 0, failed: 0 };
  const nip04 = signer.nip04;

  // The seen table is keyed by event id and does not care what kind of event
  // it was, so legacy messages get the decrypt-once guarantee for free.
  const unique = new Map<string, NostrEvent>();
  for (const event of events)
    if (event.kind === kinds.EncryptedDirectMessage && !unique.has(event.id))
      unique.set(event.id, event);

  const seen = await seenWrapIds(viewer, [...unique.keys()]);
  const todo = [...unique.values()].filter((e) => !seen.has(e.id));
  if (todo.length === 0) return { written: 0, failed: 0 };

  let written = 0;
  let failed = 0;

  for (let i = 0; i < todo.length; i += DECRYPT_WAVE) {
    const wave = todo.slice(i, i + DECRYPT_WAVE);
    const rows: DmRumorRow[] = [];
    const marks: Array<{ id: string; created_at: number; opened: boolean }> =
      [];

    await Promise.all(
      wave.map(async (event) => {
        const peer = legacyCounterparty(event, viewer);
        if (!peer) {
          // A kind 4 we wrote with no recipient names nobody: unaddressable,
          // and not a conversation.
          marks.push({
            id: event.id,
            created_at: event.created_at,
            opened: false,
          });
          return;
        }
        try {
          const plaintext = await nip04.decrypt(peer, event.content);
          const row = toLegacyDmRow(viewer, event, plaintext);
          if ("rejected" in row) {
            console.warn(`[dm] legacy refused: ${row.rejected}`);
            failed += 1;
          } else {
            rows.push(row);
          }
          marks.push({
            id: event.id,
            created_at: event.created_at,
            opened: true,
          });
        } catch (error) {
          console.warn("[dm] legacy decrypt failed:", error);
          failed += 1;
          marks.push({
            id: event.id,
            created_at: event.created_at,
            opened: false,
          });
        }
      }),
    );

    // Write, then mark seen — the same order as the gift-wrap path, and for
    // the same reason: marking first means an abort in between loses messages
    // that were already decrypted and can never be asked for again.
    const touched = new Set<string>();
    for (const row of rows) {
      await writeDmRow(row);
      touched.add(row.conversationId);
      written += 1;
    }
    await markWrapsSeen(viewer, marks);

    if (touched.size > 0)
      emitDmScopes([DM_LIST_SCOPE, ...[...touched].map(conversationScope)]);

    if (i + DECRYPT_WAVE < todo.length)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { written, failed };
}

/**
 * Walk this account's legacy history, both directions, until it runs dry.
 *
 * `follows` scopes the RECEIVED direction only — what you sent is yours by
 * definition. An empty follow list therefore imports your own side of every
 * conversation and nobody else's, which is a strange half-view; the caller
 * should skip the import rather than run it that way.
 */
export async function importLegacyDms(
  viewer: string,
  signer: LegacySigner,
  options: {
    follows: string[];
    relays?: string[];
    maxPages?: number;
    signal?: AbortSignal;
    onProgress?: (progress: LegacyImportProgress) => void;
  },
): Promise<LegacyImportProgress> {
  const progress: LegacyImportProgress = {
    fetched: 0,
    written: 0,
    failed: 0,
    exhausted: false,
  };
  if (!signer.nip04) return progress;

  const relays = options.relays ?? (await ownDmReadRelays(viewer));
  if (relays.length === 0) return progress;

  const auth = authenticateDmRelays(relays);
  const maxPages = options.maxPages ?? 20;

  // Two independent walks: a relay can be deep in one direction and shallow in
  // the other, and a shared cursor would stop both at whichever ran out first.
  const directions: Array<{ label: string; filter: Record<string, unknown> }> =
    [
      {
        label: "sent",
        filter: { kinds: [kinds.EncryptedDirectMessage], authors: [viewer] },
      },
    ];
  if (options.follows.length > 0)
    directions.push({
      label: "received",
      filter: {
        kinds: [kinds.EncryptedDirectMessage],
        authors: options.follows,
        "#p": [viewer],
      },
    });

  let allExhausted = true;

  for (const direction of directions) {
    let until: number | undefined;
    const seenThisWalk = new Set<string>();

    for (let page = 0; page < maxPages; page += 1) {
      if (options.signal?.aborted) {
        allExhausted = false;
        break;
      }

      let events: NostrEvent[];
      try {
        events = await requestEvents(
          relays,
          [
            {
              ...direction.filter,
              limit: LEGACY_PAGE,
              ...(until !== undefined ? { until } : {}),
            },
          ],
          { eventStore, timeout: 25_000 },
        );
      } catch (error) {
        console.warn(`[dm] legacy ${direction.label} page failed:`, error);
        allExhausted = false;
        break;
      }

      const fresh = events.filter((e) => !seenThisWalk.has(e.id));
      for (const event of events) seenThisWalk.add(event.id);
      if (fresh.length === 0) break;

      const outcome = await ingestLegacyDms(viewer, signer, fresh);
      progress.fetched += fresh.length;
      progress.written += outcome.written;
      progress.failed += outcome.failed;
      options.onProgress?.({ ...progress });

      console.info(
        `[dm] legacy ${direction.label} page ${page + 1}: ${fresh.length} events → ${outcome.written} stored`,
      );

      const oldest = fresh.reduce(
        (min, e) => Math.min(min, e.created_at),
        Number.POSITIVE_INFINITY,
      );
      if (!Number.isFinite(oldest)) break;
      if (until !== undefined && oldest >= until) break;
      until = oldest;

      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  auth.unsubscribe();
  progress.exhausted = allExhausted;
  if (allExhausted) await writeDmKv(importedKey(viewer), true);

  console.info(
    `[dm] legacy import ${allExhausted ? "complete" : "paused"}: ${progress.fetched} events, ${progress.written} stored, ${progress.failed} would not open`,
  );
  return progress;
}

/** Relays a legacy event was actually seen on, for diagnostics. */
export function legacySeenOn(event: NostrEvent): string[] {
  const seen = getSeenRelays(event);
  return seen ? [...seen] : [];
}
