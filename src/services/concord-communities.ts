/**
 * The Concord membership vault — read side.
 *
 * The viewer's Community List (CORD-02 §8) is the ONLY durable record of
 * Concord membership: it holds each community's `community_root` and
 * private-channel keys, NIP-44-encrypted to self. Armada owns the document;
 * grimoire fetches it, decrypts it, and mirrors the live entries into Dexie so
 * the rest of the client can enumerate communities without a signer round-trip.
 *
 * **Two generations are read at once.** §8's List is kind 33302, one addressable
 * event per fragment; the retired kind 13302 held it in a single replaceable
 * before it outgrew one event. Armada writes 13302 today, so reading only 33302
 * would empty every vault — and reading only 13302 would empty every vault the
 * day armada migrates, silently, with no error anywhere. So each event is a
 * SLOT (`kind` + `d`), each slot is kept at its own newest copy, and the union
 * of every slot is the List. §8's merges are commutative and idempotent, which
 * is exactly what makes unioning across the generations sound.
 *
 * Nothing here publishes. See `src/lib/concord/community-list.ts` for why there
 * is no serializer at all.
 *
 * The read disciplines below are ported from armada `bc19d1f`
 * (`src/concord/hooks/useCommunityList.ts`), minus its merge and its stock-relay
 * fallback (see `fetchListEvent`).
 */

import {
  KIND_COMMUNITY_LIST,
  KIND_COMMUNITY_LIST_LEGACY,
} from "@/lib/concord/kinds";
import {
  liveEntries,
  mergeCommunityLists,
  parseCommunityList,
  rehydrateCommunity,
  type CommunityList,
  type CommunityListEntry,
} from "@/lib/concord/community-list";
import { heldControlPlanes } from "@/lib/concord/control-address";
import { clearGroupKeyMemo } from "@/lib/concord/derive";
import { resetAnnouncedMemory } from "@/lib/concord/notify";
import { resetPlaneSweepMemory } from "@/lib/concord/plane-sync";
import {
  clearGroupKeyPersistence,
  initGroupKeyPersistence,
} from "@/lib/concord/group-key-persist";
import { registerStreamKeys } from "@/lib/concord/stream-auth";
import type { Community } from "@/lib/concord/types";
import { requestEvents } from "@/lib/relay-subscription";
import {
  applyAdoption,
  clearAdoptions,
  readAdoptions,
} from "@/services/concord-adoptions";
import { invalidateChannelDirectory } from "@/services/concord-channel-directory";
import { resetNotifPrefsMemory } from "@/services/concord-notif-prefs";
import { resetConcordPrefs } from "@/services/concord-prefs";
import { resetDraftCache } from "@/services/chat-drafts";
import { clearReads } from "@/services/concord-reads";
import db, { type ConcordCommunityRow } from "@/services/db";
import eventStore from "@/services/event-store";
import { startConcordStreamAuth } from "@/services/concord-stream-auth";
import { resetDissolutionMemory } from "@/services/concord-dissolution";
import { selectRelaysForFilter } from "@/services/relay-selection";
import type { NostrEvent } from "@/types/nostr";

/** The only signer capability this module needs. */
export interface Nip44Decryptor {
  nip44?: { decrypt(pubkey: string, ciphertext: string): Promise<string> };
}

export type ConcordListStatus =
  /** The list was read (or is genuinely absent) and the vault reflects it. */
  | "ok"
  /** No signer, or one without NIP-44 — the vault is whatever was last stored. */
  | "no-decryptor"
  /** A list exists but would not decrypt; the stored vault was left untouched. */
  | "decrypt-failed";

export interface ConcordListResult {
  status: ConcordListStatus;
  communities: Community[];
}

/**
 * Decode-once memo, keyed by list event id. The document is a few KB of NIP-44
 * and a remote signer round-trip can cost seconds, so re-decrypting an event we
 * have already read is the one cost worth never paying twice.
 */
const decryptMemo = new Map<string, Promise<CommunityList | undefined>>();

/**
 * How many fragments to ask for. §8 puts no ceiling on the List, but a
 * membership costs ~550 bytes and a fragment holds roughly eighty, so this is
 * thousands of memberships — far past anything a person has, and a bound on
 * what a hostile relay can make this loop over.
 */
const MAX_FRAGMENTS = 64;

/** One event of the List: the newest copy of one `(kind, d)` slot. */
interface ListSlot {
  kind: number;
  /** The fragment index in decimal; "" for the legacy single-event List. */
  d: string;
  eventId: string;
  createdAt: number;
}

const slotKey = (pubkey: string, kind: number, d: string) =>
  `concordListSlot:${pubkey}:${kind}:${d}`;

/**
 * The pre-slot floor: which single 13302 the mirror reflected, written by every
 * version of this client before the List had fragments. Read once, on the first
 * sync after upgrading, and never written again.
 */
const legacyVaultStateKey = (pubkey: string) => `concordListState:${pubkey}`;

/** A mirrored slot: its provenance, and the document it decrypted to. */
interface StoredSlot extends ListSlot {
  list: CommunityList;
}

/** The `d` tag of an addressable list fragment ("" for the legacy kind). */
function fragmentIndex(event: NostrEvent): string {
  if (event.kind === KIND_COMMUNITY_LIST_LEGACY) return "";
  return event.tags.find((t) => t[0] === "d")?.[1] ?? "";
}

/**
 * Whether an event can be a slot of THIS member's List at all.
 *
 * Kind 33302 is not grimoire's to police: other software publishes at it, and a
 * real account already carries one whose `d` is an opaque id rather than a
 * fragment index. Such an event is not encrypted to this key, so decrypting it
 * fails — and a decrypt failure is read as a HOLE in the List, which withholds
 * the whole mirror write. Recognising the shape first keeps a stranger's event
 * from freezing a member's memberships, and spares the signer a round-trip it
 * can only refuse (a bunker prompts for each one).
 *
 * §8's `d` is "the fragment index in decimal", so the shape test is exactly
 * that. An absent identifier passes: it is the empty coordinate a writer that
 * never fragmented would use.
 */
function isListSlot(event: NostrEvent): boolean {
  if (event.kind === KIND_COMMUNITY_LIST_LEGACY) return true;
  const d = fragmentIndex(event);
  return d === "" || (/^\d{1,3}$/.test(d) && Number(d) < MAX_FRAGMENTS);
}

/**
 * Fetch both generations of the List for `pubkey` from their outbox relays,
 * newest copy per slot.
 *
 * Armada additionally falls back to a hardcoded set of stock Concord relays,
 * because a user whose own relays refuse these kinds has a vault that lives
 * ONLY there. Grimoire does not hardcode relays, so a list in that position is
 * invisible here — the community simply does not appear.
 */
async function fetchListEvents(
  pubkey: string,
): Promise<Map<string, NostrEvent>> {
  const filters = [
    { kinds: [KIND_COMMUNITY_LIST], authors: [pubkey], limit: MAX_FRAGMENTS },
    { kinds: [KIND_COMMUNITY_LIST_LEGACY], authors: [pubkey], limit: 1 },
  ];
  const { relays } = await selectRelaysForFilter(eventStore, filters[0]);
  const events = await requestEvents(relays, filters);
  const newest = new Map<string, NostrEvent>();
  for (const event of events) {
    if (!isListSlot(event)) continue;
    const key = `${event.kind}:${fragmentIndex(event)}`;
    const prev = newest.get(key);
    // A relay may serve an older copy of a coordinate alongside a newer one, so
    // pick explicitly — and tie-break on the lowest id, which is how a relay
    // resolves an addressable event at equal `created_at` (§8).
    if (
      !prev ||
      event.created_at > prev.created_at ||
      (event.created_at === prev.created_at && event.id < prev.id)
    ) {
      newest.set(key, event);
    }
  }
  return newest;
}

async function decryptList(
  event: NostrEvent,
  signer: Nip44Decryptor,
  pubkey: string,
): Promise<CommunityList | undefined> {
  const cached = decryptMemo.get(event.id);
  if (cached) return cached;

  const nip44 = signer.nip44;
  if (!nip44) return undefined;
  const work = (async () => {
    try {
      return parseCommunityList(await nip44.decrypt(pubkey, event.content));
    } catch (error) {
      console.warn("[concord] could not decrypt the community list:", error);
      // Let a later call retry a transient signer failure.
      decryptMemo.delete(event.id);
      return undefined;
    }
  })();
  decryptMemo.set(event.id, work);
  return work;
}

/**
 * The slots the mirror currently reflects, per slot. Survives an empty vault.
 *
 * Armada gets the protection this buys for free from its merge — "a transient
 * short relay read can't drop rooms". Grimoire's union is per SLOT, so the same
 * protection is monotonicity per slot: a relay lagging behind on one coordinate
 * serves a genuine, decryptable, older copy, and taking it would delete the
 * rows for every community joined since — keys and all — until a fresh relay
 * answers. And a fragment nobody answered for at all is simply the copy already
 * held, which is why the decrypted document is kept beside its provenance
 * rather than only the id: an unanswered fragment must still contribute its
 * memberships to the union, or one short read empties part of the vault.
 *
 * The state is kept beside the rows rather than on them, so the floor still
 * exists for a viewer whose list is legitimately empty.
 */
async function readSlots(pubkey: string): Promise<Map<string, StoredSlot>> {
  const rows = await db.concordKv
    .where("key")
    .startsWith(`concordListSlot:${pubkey}:`)
    .toArray();
  const out = new Map<string, StoredSlot>();
  for (const row of rows) {
    const slot = row.value as StoredSlot | undefined;
    if (!slot?.list || typeof slot.kind !== "number") continue;
    out.set(`${slot.kind}:${slot.d}`, slot);
  }
  return out;
}

/**
 * The slots that contribute to the union, in the order §8 reads them.
 *
 * `frags` bounds the fragment range, and an index at or past it is out of range
 * — dormant rather than inert: a stale fragment beyond the count holds
 * memberships from before a repack shrank the List, and unioning it would
 * resurrect them. Where fragments disagree about `frags`, the newest one
 * governs and equal ages break to the LARGER value, which is the tie-break with
 * a safety argument: too large costs a fetch that comes back empty, too small
 * silently puts live memberships out of range.
 *
 * Ascending index, legacy last — so "lowest index wins" holds for the
 * fragment-level unknowns {@link mergeCommunityLists} carries through.
 */
function inRangeSlots(slots: Map<string, StoredSlot>): StoredSlot[] {
  const fragments: Array<{ index: number; slot: StoredSlot }> = [];
  const legacy: StoredSlot[] = [];
  for (const slot of slots.values()) {
    if (slot.kind === KIND_COMMUNITY_LIST_LEGACY) {
      legacy.push(slot);
      continue;
    }
    // `d` is the index in decimal. An absent one is the empty identifier every
    // relay treats as a coordinate of its own, so it reads as fragment 0 rather
    // than being dropped — a writer that never fragmented still has a List.
    if (slot.d !== "" && !/^\d+$/.test(slot.d)) continue;
    fragments.push({ index: slot.d === "" ? 0 : Number(slot.d), slot });
  }

  let frags: number | undefined;
  let declaredAt = -1;
  for (const { slot } of fragments) {
    const declared = slot.list.frags;
    if (typeof declared !== "number" || !Number.isInteger(declared)) continue;
    if (
      slot.createdAt > declaredAt ||
      (slot.createdAt === declaredAt && declared > (frags ?? 0))
    ) {
      frags = declared;
      declaredAt = slot.createdAt;
    }
  }

  return [
    ...fragments
      .filter(({ index }) => frags === undefined || index < frags)
      .sort((a, b) => a.index - b.index)
      .map(({ slot }) => slot),
    ...legacy,
  ];
}

async function writeSlot(pubkey: string, slot: StoredSlot): Promise<void> {
  await db.concordKv.put({
    key: slotKey(pubkey, slot.kind, slot.d),
    value: slot,
  });
}

/**
 * Replace this viewer's mirrored memberships with exactly `entries`.
 *
 * One transaction, delete-then-put: a community the user left must disappear,
 * and a partial write would leave the vault claiming a membership the list no
 * longer carries. Tombstones are not stored — liveness is resolved here, at
 * decrypt time, and only live entries are mirrored.
 */
async function replaceVault(
  pubkey: string,
  entries: CommunityListEntry[],
  newest: ListSlot,
): Promise<void> {
  const now = Date.now();
  const rows: ConcordCommunityRow[] = entries.map((entry) => ({
    pubkey,
    idHex: entry.community_id.toLowerCase(),
    entry,
    name: typeof entry.current?.name === "string" ? entry.current.name : "",
    // Provenance of the whole union, named by its newest contributing event —
    // the fragments are individually monotonic in `concordKv`, so this is a
    // label rather than the floor it used to be.
    listEventId: newest.eventId,
    listCreatedAt: newest.createdAt,
    updatedAt: now,
  }));
  await db.transaction("rw", db.concordCommunities, async () => {
    await db.concordCommunities.where("pubkey").equals(pubkey).delete();
    if (rows.length > 0) await db.concordCommunities.bulkPut(rows);
  });
}

/**
 * Read the viewer's memberships out of Dexie, rehydrated.
 *
 * Works with no signer and no network — that is the point of mirroring. A row
 * whose owner commitment does not verify is dropped rather than surfaced
 * (`rehydrateCommunity` fails closed).
 */
export async function loadStoredCommunities(
  pubkey: string,
): Promise<Community[]> {
  const [rows, adoptions] = await Promise.all([
    db.concordCommunities.where("pubkey").equals(pubkey).toArray(),
    readAdoptions(pubkey),
  ]);
  const out: Community[] = [];
  const spent: string[] = [];
  for (const row of rows) {
    const rehydrated = rehydrateCommunity(row.entry as CommunityListEntry);
    if (!rehydrated) continue;
    // Layer on anything this device adopted from a rotation the list has not
    // caught up with yet. A row the list HAS caught up with is spent — dropped
    // here rather than left to shadow a newer list forever.
    const { community, spent: done } = applyAdoption(
      rehydrated,
      adoptions.get(rehydrated.idHex),
    );
    if (done && adoptions.has(rehydrated.idHex)) spent.push(rehydrated.idHex);
    out.push(community);
  }
  for (const idHex of spent) void clearAdoptions(pubkey, idHex);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * When this viewer joined a community, in epoch-ms (the list entry's
 * `added_at`), or UNDEFINED when it cannot be established.
 *
 * The removal decision needs it: a complete rotation carrying no blob for us is
 * an exclusion only if it published AT OR AFTER we joined. One that predates the
 * join is community history a stale invite dropped us onto, and reading it as a
 * removal would eject every fresh joiner seconds after they arrive.
 *
 * **NOT ZERO ON FAILURE.** A join time of 0 makes every rotation in history
 * postdate the join, which turns that guard off entirely — the one guard whose
 * absence costs a member their channels. A missing row, a non-numeric
 * `added_at` (the list parser tolerates anything) or a Dexie failure are all
 * "we do not know", and armada's answer to not knowing is to not act at all
 * (`if (!entry) return; // the removal decision needs my join time`). So this
 * returns undefined and the caller declines to run.
 */
export async function readJoinedAtMs(
  pubkey: string,
  idHex: string,
): Promise<number | undefined> {
  try {
    const row = await db.concordCommunities.get([pubkey, idHex]);
    if (!row) return undefined;
    const addedAt = (row.entry as CommunityListEntry | undefined)?.added_at;
    return typeof addedAt === "number" && Number.isFinite(addedAt)
      ? addedAt
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch, decrypt and mirror the viewer's Community List, then return the
 * memberships.
 *
 * Fails soft in both directions that matter. Without a NIP-44 signer (a
 * read-only account, or a remote signer still connecting) the stored vault is
 * returned as-is rather than throwing — the communities must not blank while a
 * signer wakes up. And a list that will not decrypt NEVER clears the vault: the
 * keys live in that document, so a wrongful empty would look exactly like
 * leaving every community at once.
 */
export async function syncCommunities(
  pubkey: string,
  signer: Nip44Decryptor | undefined,
): Promise<ConcordListResult> {
  // The first Concord read is where the derivation cache is worth hydrating:
  // everything downstream of a membership derives stream keys from it.
  await initGroupKeyPersistence();

  const stored = await loadStoredCommunities(pubkey);
  // Register before the fetch, not after: the vault may already hold every
  // community, and the stream keys have to be in the registry before anything
  // sweeps a plane.
  registerControlAddresses(stored);
  if (!signer?.nip44) return { status: "no-decryptor", communities: stored };

  const [fetched, slots] = await Promise.all([
    fetchListEvents(pubkey),
    readSlots(pubkey),
  ]);

  // The floor an account carries over from before slots existed. Without it,
  // the first sync after upgrading has NO floor at all, and a lagging relay
  // serving a genuine older list is accepted and mirrored — deleting the rows
  // for every community joined since it, keys included. Exactly the
  // wrongful-empty the previous global floor existed to prevent.
  const legacyFloor = slots.has(`${KIND_COMMUNITY_LIST_LEGACY}:`)
    ? undefined
    : ((await db.concordKv.get(legacyVaultStateKey(pubkey)))?.value as
        { eventId: string; createdAt: number } | undefined);

  let unreadable = 0;
  for (const [key, event] of fetched) {
    const held = slots.get(key);
    // Checked before the decrypt so a lagging relay costs no signer round-trip.
    if (held) {
      if (held.eventId === event.id) continue;
      if (event.created_at < held.createdAt) continue;
    } else if (
      legacyFloor &&
      event.kind === KIND_COMMUNITY_LIST_LEGACY &&
      (event.id === legacyFloor.eventId ||
        event.created_at < legacyFloor.createdAt)
    ) {
      continue;
    }
    const list = await decryptList(event, signer, pubkey);
    if (!list) {
      // A slot with a copy already held keeps it and the union stands. One
      // with NO held copy is a hole in the union, and mirroring a union with a
      // hole in it deletes the memberships that slot carries — so the whole
      // write is withheld below instead.
      if (!held) unreadable++;
      continue;
    }
    const slot: StoredSlot = {
      kind: event.kind,
      d: fragmentIndex(event),
      eventId: event.id,
      createdAt: event.created_at,
      list,
    };
    slots.set(key, slot);
    await writeSlot(pubkey, slot);
  }

  const contributing = inRangeSlots(slots);
  if (contributing.length === 0) {
    // Nothing on any relay we asked and nothing held. That is not proof there
    // is no list (the relays may simply not carry it), so the vault stands.
    return {
      status: unreadable > 0 ? "decrypt-failed" : "ok",
      communities: stored,
    };
  }
  if (unreadable > 0) {
    // A partial union is not a smaller list, it is a WRONG one: the mirror is
    // replaced wholesale, so writing it would delete the memberships living in
    // the slot that would not open. One flaky signer round-trip — routine with
    // a bunker, and there is one call per fragment — must not cost keys.
    return { status: "decrypt-failed", communities: stored };
  }

  const live = liveEntries(
    // Fragments outrank the retired generation at equal epoch: the legacy event
    // is never rewritten once a writer migrates, so a same-epoch change — a
    // rename, a relay swap, a newly granted channel key — would otherwise be
    // decided by canonical bytes and could settle on the stale copy forever.
    mergeCommunityLists(
      contributing.map((slot) => ({
        list: slot.list,
        rank: slot.kind === KIND_COMMUNITY_LIST_LEGACY ? 1 : 0,
      })),
    ),
  );
  const newest = contributing.reduce((a, b) =>
    b.createdAt > a.createdAt ? b : a,
  );
  await replaceVault(pubkey, live, newest);
  const communities = await loadStoredCommunities(pubkey);
  registerControlAddresses(communities);
  return { status: "ok", communities };
}

/**
 * Register every held epoch's Control Plane address for NIP-42, scoped to the
 * community's own relays, and start the socket-lifecycle wiring.
 *
 * EVERY held epoch, not just the current one: an address missing from the
 * registry reports "not yet registered" to the auth gate rather than "accounted
 * for", which blocks a sweep instead of letting it proceed. A SPLIT epoch
 * registers ADDRESS-ONLY — its signing secret derives from a `control_root`
 * only staff hold (CORD-02 §2) — so on a gating relay that plane is simply
 * unreadable, and reporting that beats waiting forever for an ack that cannot
 * come.
 */
export function registerControlAddresses(communities: Community[]): void {
  startConcordStreamAuth();
  for (const community of communities) {
    if (community.relays.length === 0) continue;
    const keys = heldControlPlanes(community).map((plane) => ({
      pk: plane.group.pk,
      ...(plane.canAuthenticate && plane.group.sk
        ? { sk: plane.group.sk }
        : {}),
    }));
    registerStreamKeys(keys, community.relays);
  }
}

/**
 * Wipe one account's Concord state on logout: the mirrored memberships, the
 * decrypted message bodies, and every derivation cache and cursor.
 *
 * **The keys are not the sensitive half.** The vault rows hold decrypted
 * `community_root`s and channel keys, so they obviously go — but
 * `concordRumors` holds the PLAINTEXT of every message ever read: who wrote it,
 * when, and what it said. Clearing the keys and leaving those behind protects
 * nothing, because nothing has to be decrypted a second time. Someone logging
 * out to take a community off a machine means the conversations too.
 *
 * The rumor store, snapshots and `concordKv` are all keyed by COMMUNITY, not by
 * account, so there is no account-scoped delete to issue against them. This
 * wipes them whole. That is correct while grimoire is single-account, and it is
 * the reason a second account would need those tables scoped BEFORE it shipped
 * — otherwise one logout takes the other account's history with it.
 */
export async function clearCommunities(pubkey: string): Promise<void> {
  // allSettled, NOT all, and NOT sequential awaits: a rejection anywhere in a
  // `Promise.all` — or a throw from an earlier `await` — abandons every wipe
  // after it, which on a wipe is precisely backwards. One table erroring would
  // silently leave the rest full. Every table gets its attempt, and whatever
  // failed is reported rather than swallowed.
  const wipes = await Promise.allSettled([
    db.concordCommunities.where("pubkey").equals(pubkey).delete(),
    // Adoptions hold decrypted roots and channel keys of their own — leaving
    // them behind would keep this account's key material after the vault is
    // gone.
    clearAdoptions(pubkey),
    // Decrypted rumors, control snapshots, parked wraps, and every cursor,
    // fold, seen-memo, dissolution verdict and notification level in
    // `concordKv`. The table is emptied WHOLE and is treated as Concord-owned,
    // which the notification levels now qualify rather than contradict: their
    // keys carry a protocol so a NIP-29 container cannot collide with a
    // community, but the rows still live here and a Concord logout still takes
    // them. A family that must outlive one needs its own table, not a
    // different key.
    db.concordRumors.clear(),
    db.concordSnapshots.clear(),
    db.concordPendingWraps.clear(),
    db.concordKv.clear(),
    // Read state is account-scoped, so unlike the rest of these it can be
    // deleted for the account that left and nobody else. It says which channels
    // this person was reading and when they last looked.
    clearReads(pubkey),
    // Queued sends and half-typed drafts are the most plainly personal rows
    // here: prose this account WROTE, that no relay has even seen. Both are
    // account-scoped — the outbox by column, the drafts by key prefix, since
    // the account is the first segment of a draft's key. Written out here
    // rather than called through their own services, which would import this
    // module back and close a cycle around the community loader.
    db.concordOutbox.where("pubkey").equals(pubkey).delete(),
    db.chatDrafts.where("key").startsWith(`${pubkey}:`).delete(),
  ]);
  const failed = wipes.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(
      "[concord] some tables survived the logout wipe:",
      failed.map((r) => r.reason),
    );
  }
  // In-memory, and outliving the tables otherwise: the derivation memo holds
  // stream secrets, and the sweep memos hold wrap ids from the account that
  // just left.
  clearGroupKeyMemo();
  resetPlaneSweepMemory();
  resetDissolutionMemory();
  clearDecryptMemo();
  // The channel directory holds decrypted community and channel NAMES, which
  // would otherwise outlive the fold they were read from.
  invalidateChannelDirectory();
  // Notification levels live in `concordKv`, which the wipe above emptied — so
  // the memo in front of it has to go too, or the tab keeps answering with
  // levels that no longer exist and hands them to whoever signs in next.
  resetNotifPrefsMemory();
  // Pins, folded categories and the channel each community was left on. These
  // live in localStorage rather than `concordKv`, so the table wipe above does
  // not reach them — and they must go for the same reason the levels do: they
  // name the communities and channels this account cared enough to arrange.
  resetConcordPrefs();
  // The ids of every message this tab has already announced. Opaque and
  // bounded, so nothing leaks — but it is the account's traffic, and the memo
  // block is where the account's traces go.
  resetAnnouncedMemory();
  // Drafts are cached in memory to answer a render synchronously, so the rows
  // going is not enough — the tab would keep handing them to the next account.
  resetDraftCache();
  await clearGroupKeyPersistence();
}

/**
 * Forget which list events have already been decrypted.
 *
 * The memo caches decrypted Community Lists by event id, so it holds the
 * account's memberships in memory after their rows are gone.
 */
export function clearDecryptMemo(): void {
  decryptMemo.clear();
}

/** Test seam: {@link clearDecryptMemo}. */
export function _resetDecryptMemoForTests(): void {
  clearDecryptMemo();
}
