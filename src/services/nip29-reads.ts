/**
 * How far into each NIP-29 group this account has read.
 *
 * The third protocol over one `chatReads` table, after Concord and NIP-17. The
 * table was keyed for this shape from the start — `db.ts` documents
 * `containerId` as "Concord: community idHex. NIP-29 (later): relay URL" —
 * because a NIP-29 `(relay, group)` pair occupies the same row a Concord
 * `(community, channel)` pair does.
 *
 * Never published. No NIP defines a read marker, and one that was would tell a
 * relay when its members are looking.
 *
 * Dexie rather than a jotai atom for the reason the other two are: the
 * requirement is multi-WINDOW. `grimoireStateAtom`'s storage has no `subscribe`,
 * so two chat windows over one IndexedDB see each other's marks only through
 * `useLiveQuery`.
 */

import db, { type ChatReadRow } from "./db";
import { normalizeRelayURL } from "@/lib/relay-url";

const PROTOCOL = "nip-29" as const;

/**
 * The relay, canonicalized — and this is the one thing here that has to be
 * right.
 *
 * The same relay reaches this module spelled two ways. The sidebar's
 * `extractGroupEntries` builds its URL with `new URL(...).toString()`, which
 * appends a trailing slash; the adapter's `parseIdentifier` only prefixes
 * `wss://`, keeping whatever case and path the user typed. Written raw, the pane
 * would stamp `wss://relay.example.com` while the badge read
 * `wss://relay.example.com/` — a badge nothing can clear. So every key runs
 * through the app's normalizer, and callers may hand over either spelling.
 *
 * `normalizeRelayURL` throws on garbage; an unusable relay yields no row rather
 * than taking down the caller, which for a read cursor is the right failure.
 */
function containerFor(relayUrl: string): string | undefined {
  try {
    return normalizeRelayURL(relayUrl);
  } catch {
    return undefined;
  }
}

/**
 * The group id, VERBATIM — deliberately not lowercased.
 *
 * Concord lowercases its channel ids because they are hex. A NIP-29 group id is
 * an arbitrary relay-assigned string and the `#h` filter is case-sensitive, so
 * `Bitcoin` and `bitcoin` on one relay are two rooms; folding their stamps
 * together would clear the wrong one. `dm-reads.ts` treats its conversation id
 * the same way — the db comment mandates lowercase for `containerId` alone.
 */
const key = (
  pubkey: string,
  container: string,
  groupId: string,
): [string, typeof PROTOCOL, string, string] => [
  pubkey,
  PROTOCOL,
  container,
  groupId,
];

/**
 * Unix seconds. 0 means never read, which is not the same as all read.
 *
 * 0 badges the whole history and shows NO divider — flagging every message in a
 * group someone just joined is noise. Degrades to 0 on a storage error too: a
 * badge that reads high is a far smaller failure than a group that will not
 * open.
 */
export async function readGroupLastRead(
  pubkey: string,
  relayUrl: string,
  groupId: string,
): Promise<number> {
  const container = containerFor(relayUrl);
  if (!pubkey || !container || !groupId) return 0;
  try {
    const row = await db.chatReads.get(key(pubkey, container, groupId));
    return row?.lastRead ?? 0;
  } catch (error) {
    console.warn("[nip-29] could not read the last-read stamp:", error);
    return 0;
  }
}

/**
 * Every stamp this account holds on one relay, by group id.
 *
 * One index range over `[pubkey+protocol+containerId]` rather than a read per
 * group: the sidebar asks about every group on a relay at once, on every
 * emission of the live query.
 */
export async function readRelayLastReads(
  pubkey: string,
  relayUrl: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const container = containerFor(relayUrl);
  if (!pubkey || !container) return out;
  try {
    const rows = await db.chatReads
      .where("[pubkey+protocol+containerId]")
      .equals([pubkey, PROTOCOL, container])
      .toArray();
    for (const row of rows) out.set(row.channelId, row.lastRead);
  } catch (error) {
    console.warn("[nip-29] could not read this relay's stamps:", error);
  }
  return out;
}

/** Every NIP-29 stamp this account holds, keyed `<normalized relay>'<group>`. */
export async function readAllGroupLastReads(
  pubkey: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!pubkey) return out;
  try {
    const rows = await db.chatReads
      .where("pubkey")
      .equals(pubkey)
      .and((row) => row.protocol === PROTOCOL)
      .toArray();
    for (const row of rows)
      out.set(`${row.containerId}'${row.channelId}`, row.lastRead);
  } catch (error) {
    console.warn("[nip-29] could not read the group stamps:", error);
  }
  return out;
}

/**
 * Move one group's stamp forward. Never backwards, and never into the future.
 *
 * Monotonic INSIDE the transaction, not merely in the caller: two chat windows
 * marking the same group at once would otherwise both read the old value and the
 * slower write would silently rewind the faster one.
 *
 * **Clamped at `now`, not at `now + NIP29_READ_MAX_FUTURE_SECS`** — the one place
 * this protocol departs from `dm-reads.ts` and Concord, and the reason is that a
 * NIP-29 stamp is also a network fetch bound (`since` on the sidebar's
 * `kinds:[9]` REQ). Let it settle an hour ahead, as the scan's ceiling would
 * allow, and every message genuinely sent during that hour falls below it: never
 * requested, never counted, never shown as new. The other two protocols scan a
 * local mirror, so there the ceiling costs nothing.
 *
 * The scan keeps the wider allowance, so a future-dated message still badges. It
 * simply cannot be stamped until the clock reaches it, which heals on its own.
 *
 * A zero or negative stamp is ignored — it is what an empty group produces, and
 * writing it would replace a real stamp with nothing.
 */
export async function markGroupRead(
  pubkey: string,
  relayUrl: string,
  groupId: string,
  timestampSecs: number,
): Promise<void> {
  const container = containerFor(relayUrl);
  if (!pubkey || !container || !groupId) return;
  if (!Number.isFinite(timestampSecs) || timestampSecs <= 0) return;
  const clamped = Math.min(timestampSecs, Math.floor(Date.now() / 1000));
  if (clamped <= 0) return;
  const id = key(pubkey, container, groupId);
  try {
    await db.transaction("rw", db.chatReads, async () => {
      const existing = await db.chatReads.get(id);
      if (existing && existing.lastRead >= clamped) return;
      const row: ChatReadRow = {
        pubkey: id[0],
        protocol: id[1],
        containerId: id[2],
        channelId: id[3],
        lastRead: clamped,
        updatedAt: Date.now(),
      };
      await db.chatReads.put(row);
    });
  } catch (error) {
    console.warn("[nip-29] could not stamp the group as read:", error);
  }
}

/**
 * Forget every NIP-29 stamp this account holds.
 *
 * Not wired to logout, and does not need to be: `clearReads` in
 * `concord-reads.ts` deletes by the `pubkey` index across every protocol, and
 * `clearCommunities` already calls it on sign-out. Here for symmetry with the
 * other two modules and for tests.
 */
export async function clearGroupReads(pubkey: string): Promise<void> {
  if (!pubkey) return;
  try {
    await db.chatReads
      .where("pubkey")
      .equals(pubkey)
      .and((row) => row.protocol === PROTOCOL)
      .delete();
  } catch (error) {
    console.warn("[nip-29] could not clear the group stamps:", error);
  }
}

/**
 * How one group is named across the read-state boundary.
 *
 * The join key, and the second half of the canonicalization trap {@link
 * containerFor} guards. `chatReads` rows carry a normalized `containerId` while
 * the sidebar keys its message windows by the raw `relayUrl'groupId` out of
 * `extractGroupEntries` — so the hooks that join the two must normalize the
 * relay HERE rather than each rolling their own, or stamps and counts miss each
 * other one layer above where the row key fixed it.
 *
 * Matches {@link readAllGroupLastReads}' keys by construction: same normalizer,
 * same separator.
 */
export function groupReadKey(
  relayUrl: string,
  groupId: string,
): string | undefined {
  const container = containerFor(relayUrl);
  return container && groupId ? `${container}'${groupId}` : undefined;
}
