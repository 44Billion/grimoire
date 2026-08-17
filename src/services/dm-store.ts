/**
 * The local mirror of this account's NIP-17 messages.
 *
 * A gift wrap is opened exactly once, here, and what persists is the rumor its
 * author signed. Everything downstream — the conversation list, a thread, the
 * unread count — is an indexed Dexie query with no crypto in it, so a reload
 * costs no signer prompts and works with no relay reachable. This is the same
 * contract `concord-rumor-store.ts` holds, for the same reasons.
 *
 * **This module is the only door.** Every acceptance rule lives here so there
 * is one place to read them and one place they can be wrong:
 *
 * - kinds 14 (message), 15 (file), 7 (reaction) and 5 (delete) only;
 * - the rumor id is recomputed and a lying one refused;
 * - a rumor whose author is not a participant is refused, which is NIP-59's
 *   own anti-spoof rule pushed to the last possible moment;
 * - a rumor already past its NIP-40 deadline is refused, and one with a future
 *   deadline is stored with it and hidden when it passes.
 *
 * Rows are plaintext at rest, like the Concord rumors beside them, and a
 * logout wipes them.
 */

import Dexie from "dexie";
import { getEventHash } from "nostr-tools";
import { createConversationIdentifier } from "applesauce-common/helpers/messages";
import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import db, { type DmRumorRow } from "./db";

/** Kinds that occupy a row in a DM timeline. */
export const DM_ROW_KINDS = [14, 15];
/** A moderator-less self-delete (NIP-09). */
export const DM_DELETE_KIND = 5;
/** A reaction (NIP-25), wrapped like everything else so it stays private. */
export const DM_REACTION_KIND = 7;
/** Kinds that act on another rumor rather than standing alone. */
export const DM_SIDE_KINDS = [DM_DELETE_KIND, DM_REACTION_KIND];
const ACCEPTED_KINDS = new Set([...DM_ROW_KINDS, ...DM_SIDE_KINDS]);

/**
 * How far ahead of us a rumor's `created_at` may sit before we stop believing
 * it. Timestamps are author-chosen; without a bound one message pins itself to
 * the top of a conversation forever.
 */
export const DM_MAX_FUTURE_SECS = 15 * 60;

const nowSecs = () => Math.floor(Date.now() / 1000);

/**
 * Everyone a rumor is between: its author plus its `p` tags.
 *
 * Deliberately not applesauce's `getConversationParticipants`, which THROWS for
 * any kind other than 4 and 14 — a kind-15 file message and a kind-5 delete are
 * both ordinary traffic in a NIP-17 conversation and both would crash ingest.
 * The identifier it produces is identical, so the two stay interchangeable.
 */
export function participantsOf(rumor: {
  pubkey: string;
  tags: string[][];
}): string[] {
  const tagged = rumor.tags
    .filter((t) => t[0] === "p" && t[1])
    .map((t) => t[1]);
  return Array.from(new Set([rumor.pubkey, ...tagged]));
}

/** The NIP-40 deadline on a rumor, if it carries one. */
function expirationOf(tags: string[][]): number | undefined {
  const tag = tags.find((t) => t[0] === "expiration" && t[1]);
  if (!tag) return undefined;
  const value = Number.parseInt(tag[1], 10);
  return Number.isFinite(value) ? value : undefined;
}

/** A rumor that has outlived its NIP-40 deadline is not shown, ever. */
export function isExpired(
  row: { expiration?: number },
  at = nowSecs(),
): boolean {
  return row.expiration !== undefined && row.expiration <= at;
}

/**
 * Vet one rumor and shape it into a row, or say why not.
 *
 * Exported for the tests, which is the point: these rules are the security
 * boundary between "a message someone sent me" and "a message someone claims
 * someone else sent me", and they deserve to be asserted directly rather than
 * through an ingest pipeline.
 */
export function toDmRow(
  viewer: string,
  rumor: Rumor,
): DmRumorRow | { rejected: string } {
  if (!ACCEPTED_KINDS.has(rumor.kind))
    return { rejected: `kind ${rumor.kind} is not a direct message` };

  const computedId = getEventHash(rumor);
  if (rumor.id !== computedId) return { rejected: "rumor id does not match" };

  if (rumor.created_at > nowSecs() + DM_MAX_FUTURE_SECS)
    return { rejected: "rumor is dated too far in the future" };

  // A wrap addressed to this account whose rumor names other people entirely
  // is someone using our mailbox as a drop box for a conversation we are not
  // in. It would show up as a conversation we cannot answer.
  //
  // Side rows are exempt, and have to be: a NIP-09 delete usually carries only
  // an `e` tag, so its participant list is just its author. Requiring the
  // viewer there dropped every inbound delete on the floor. What makes a side
  // row safe is not its p tags but that it arrived in this account's mailbox
  // and points at a rumor — the fold matches it by `author:targetId`, so where
  // it happens to be filed does not matter.
  const participants = participantsOf(rumor);
  const isSideRow = DM_SIDE_KINDS.includes(rumor.kind);
  if (!isSideRow && !participants.includes(viewer))
    return { rejected: "viewer is not a participant" };

  const expiration = expirationOf(rumor.tags);
  if (expiration !== undefined && expiration <= nowSecs())
    return { rejected: "rumor has expired" };

  return {
    id: computedId,
    viewer,
    conversationId: createConversationIdentifier(participants),
    kind: rumor.kind,
    created_at: rumor.created_at,
    pubkey: rumor.pubkey,
    content: rumor.content,
    tags: rumor.tags,
    ...(expiration !== undefined ? { expiration } : {}),
  };
}

export interface WriteResult {
  /** Rows that landed. */
  written: DmRumorRow[];
  /** Conversation ids whose contents changed, for the doorbell. */
  touched: string[];
}

/**
 * Write vetted rumors and refresh the conversation summaries they belong to.
 *
 * One transaction over both tables: a summary that names a conversation with
 * no rows in it would put a ghost in the sidebar, and rows with no summary
 * would be mail that arrived without the list noticing.
 */
export async function writeDmRumors(
  viewer: string,
  rumors: Rumor[],
): Promise<WriteResult> {
  const rows: DmRumorRow[] = [];
  const participantsById = new Map<string, string[]>();
  for (const rumor of rumors) {
    const result = toDmRow(viewer, rumor);
    if ("rejected" in result) continue;
    rows.push(result);
    participantsById.set(result.conversationId, participantsOf(rumor).sort());
  }
  if (rows.length === 0) return { written: [], touched: [] };

  const touched = new Set(rows.map((r) => r.conversationId));

  await db.transaction("rw", db.dmRumors, db.dmConversations, async () => {
    await db.dmRumors.bulkPut(rows);

    for (const conversationId of touched) {
      // Recomputed from the stored rows rather than from this batch: a
      // backfill delivers old messages, and taking the batch's newest would
      // walk the sidebar backwards.
      const newest = await db.dmRumors
        .where("[viewer+conversationId+created_at]")
        .between(
          [viewer, conversationId, Dexie.minKey],
          [viewer, conversationId, Dexie.maxKey],
        )
        .reverse()
        .filter((r) => DM_ROW_KINDS.includes(r.kind))
        .first();

      // A conversation whose only rows are deletes has nothing to show. That
      // happens legitimately — a tombstone can outrun the message it removes —
      // so it must not put an empty row in the sidebar while it waits.
      if (!newest) continue;

      await db.dmConversations.put({
        viewer,
        conversationId,
        participants: participantsById.get(conversationId) ?? [],
        lastAt: newest.created_at,
      });
    }
  });

  return { written: rows, touched: [...touched] };
}

/** Conversations this account has, newest first. */
export async function listDmConversations(viewer: string) {
  const rows = await db.dmConversations
    .where("[viewer+lastAt]")
    .between([viewer, Dexie.minKey], [viewer, Dexie.maxKey])
    .reverse()
    .toArray();
  return rows;
}

/**
 * One conversation's newest `limit` rows, plus the side rows that act on them.
 *
 * `until` pages backwards. Two widenings matter:
 *
 * - Side rows are collected across the whole conversation rather than the
 *   page, because a tombstone written today removes a message from a page
 *   loaded from last year, and a fold that cannot see it renders a message its
 *   author erased.
 * - They are collected across the whole VIEWER, not this conversation. A
 *   delete carrying only an `e` tag is filed under its author alone, and in a
 *   group DM under a two-person conversation that does not exist — scoping the
 *   lookup to this conversation is how a tombstone goes missing. Target ids are
 *   globally unique, so the wider read cannot mis-apply one.
 */
export async function queryConversation(
  viewer: string,
  conversationId: string,
  opts: { limit: number; until?: number } = { limit: 200 },
): Promise<DmRumorRow[]> {
  if (opts.limit <= 0) return [];
  const upper = opts.until ?? Dexie.maxKey;

  const collected: DmRumorRow[] = [];
  let rows = 0;
  let budgetSpentAt: number | undefined;

  await db.dmRumors
    .where("[viewer+conversationId+created_at]")
    .between(
      [viewer, conversationId, Dexie.minKey],
      [viewer, conversationId, upper],
      true,
      true,
    )
    .reverse()
    // One row past the budget, so a message's same-second siblings are not
    // split across two pages.
    .until(
      (row) => budgetSpentAt !== undefined && row.created_at < budgetSpentAt,
      false,
    )
    .each((row) => {
      collected.push(row);
      if (!DM_ROW_KINDS.includes(row.kind)) return;
      rows += 1;
      if (rows === opts.limit) budgetSpentAt = row.created_at;
    });

  const timeline = collected
    .filter((r) => DM_ROW_KINDS.includes(r.kind))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, opts.limit);

  const side = await db.dmRumors
    .where("[viewer+created_at]")
    .between([viewer, Dexie.minKey], [viewer, Dexie.maxKey])
    .filter((r) => DM_SIDE_KINDS.includes(r.kind))
    .toArray();

  // Only the ones pointing into this page. A viewer-wide read would otherwise
  // hand the fold every reaction the account has ever received.
  const visible = new Set(timeline.map((r) => r.id));
  const relevant = side.filter((r) =>
    r.tags.some((t) => t[0] === "e" && t[1] && visible.has(t[1])),
  );

  return [...timeline, ...relevant];
}

/**
 * Apply deletes and expiry to a page.
 *
 * Nothing is ever removed from the table — `writeDmRumors` only puts — so the
 * removal is re-applied on every read. That is what lets a delete arrive
 * BEFORE the message it deletes, which over an unordered relay set is not an
 * edge case.
 *
 * A self-delete leaves nothing behind. NIP-09 asks that the event go away, and
 * a tombstone reading "this person deleted something" advertises exactly what
 * the request was for. Only the author can delete their own DM here, so there
 * is no moderation case where naming the removal would be honest.
 */
export function foldDmMessages(
  rows: DmRumorRow[],
  at = nowSecs(),
): DmRumorRow[] {
  const deleted = new Set<string>();
  for (const row of rows) {
    // Kind 5 ONLY. A reaction is also a side row and also carries an `e` tag —
    // treating every side kind alike would make liking a message delete it.
    if (row.kind !== DM_DELETE_KIND) continue;
    for (const tag of row.tags) {
      // Authors delete their own messages and no one else's — a kind 5 naming
      // someone else's rumor is a stranger trying to edit your mailbox.
      if (tag[0] === "e" && tag[1]) deleted.add(`${row.pubkey}:${tag[1]}`);
    }
  }

  return rows
    .filter((row) => DM_ROW_KINDS.includes(row.kind))
    .filter((row) => !deleted.has(`${row.pubkey}:${row.id}`))
    .filter((row) => !isExpired(row, at))
    .sort((a, b) => a.created_at - b.created_at);
}

/**
 * Reactions in a page, grouped by the rumor they are about.
 *
 * Read from the same rows the timeline folds, never fetched: a DM reaction is a
 * kind-7 RUMOR that exists on no relay, and asking one for reactions to a
 * private message id would announce both the conversation and the id.
 *
 * A reaction whose target is gone — deleted or expired — is dropped with it,
 * which is why the surviving ids are passed in rather than inferred.
 */
export function dmReactionsByTarget(
  rows: DmRumorRow[],
  visibleIds: Set<string>,
  at = nowSecs(),
): Map<string, DmRumorRow[]> {
  const byTarget = new Map<string, DmRumorRow[]>();
  // One reaction per author per target: a resend, or the same emoji arriving
  // from both our own copy and the peer's relay, is one feeling either way.
  const seen = new Set<string>();

  for (const row of rows) {
    if (row.kind !== DM_REACTION_KIND) continue;
    if (isExpired(row, at)) continue;
    const target = row.tags.find((t) => t[0] === "e" && t[1])?.[1];
    if (!target || !visibleIds.has(target)) continue;

    const signature = `${target}:${row.pubkey}:${row.content}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    const list = byTarget.get(target);
    if (list) list.push(row);
    else byTarget.set(target, [row]);
  }

  return byTarget;
}

/** Wrap ids this viewer has already tried, opened or not. */
export async function seenWrapIds(
  viewer: string,
  wrapIds: string[],
): Promise<Set<string>> {
  if (wrapIds.length === 0) return new Set();
  const keys = wrapIds.map((wrapId) => [viewer, wrapId]);
  const rows = await db.dmSeenWraps.bulkGet(keys);
  return new Set(rows.filter((r) => !!r).map((r) => r!.wrapId));
}

/** Record that a wrap was dealt with. `opened: false` means it never will be. */
export async function markWrapsSeen(
  viewer: string,
  wraps: Array<{ id: string; created_at: number; opened: boolean }>,
): Promise<void> {
  if (wraps.length === 0) return;
  await db.dmSeenWraps.bulkPut(
    wraps.map((w) => ({
      viewer,
      wrapId: w.id,
      wrapAt: w.created_at,
      opened: w.opened,
    })),
  );
}

/**
 * Delete every rumor past its deadline, and correct what it leaves behind.
 *
 * The summaries have to be recomputed in the same breath: a conversation whose
 * newest message just expired would otherwise keep a sidebar row pointing at a
 * timestamp no row backs, and one whose ONLY messages expired would keep a row
 * that opens onto nothing.
 */
export async function sweepExpiredDms(
  viewer: string,
  at = nowSecs(),
): Promise<number> {
  const expired = await db.dmRumors
    .where("[viewer+created_at]")
    .between([viewer, Dexie.minKey], [viewer, Dexie.maxKey])
    .filter((r) => isExpired(r, at))
    .toArray();
  if (expired.length === 0) return 0;

  const touched = new Set(expired.map((r) => r.conversationId));

  await db.transaction("rw", db.dmRumors, db.dmConversations, async () => {
    await db.dmRumors.bulkDelete(expired.map((r) => [r.viewer, r.id]));

    for (const conversationId of touched) {
      const newest = await db.dmRumors
        .where("[viewer+conversationId+created_at]")
        .between(
          [viewer, conversationId, Dexie.minKey],
          [viewer, conversationId, Dexie.maxKey],
        )
        .reverse()
        .filter((r) => DM_ROW_KINDS.includes(r.kind))
        .first();

      if (newest)
        await db.dmConversations.update([viewer, conversationId], {
          lastAt: newest.created_at,
        });
      else await db.dmConversations.delete([viewer, conversationId]);
    }
  });

  return expired.length;
}

export async function readDmKv<T>(key: string): Promise<T | undefined> {
  const row = await db.dmKv.get(key);
  return row?.value as T | undefined;
}

export async function writeDmKv(key: string, value: unknown): Promise<void> {
  await db.dmKv.put({ key, value });
}

/**
 * Forget everything this account holds. Called on logout.
 *
 * Private mail left behind after a logout is the failure that matters most
 * here, so this deletes rows rather than marking them.
 */
export async function clearDirectMessages(viewer: string): Promise<void> {
  await db.transaction(
    "rw",
    db.dmRumors,
    db.dmConversations,
    db.dmSeenWraps,
    db.dmKv,
    async () => {
      await db.dmRumors
        .where("[viewer+created_at]")
        .between([viewer, Dexie.minKey], [viewer, Dexie.maxKey])
        .delete();
      await db.dmConversations
        .where("[viewer+lastAt]")
        .between([viewer, Dexie.minKey], [viewer, Dexie.maxKey])
        .delete();
      await db.dmSeenWraps
        .where("[viewer+wrapAt]")
        .between([viewer, Dexie.minKey], [viewer, Dexie.maxKey])
        .delete();
      await db.dmKv.where("key").startsWith(`${viewer}:`).delete();
    },
  );
}
