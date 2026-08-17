/**
 * The invite inbox — what has been offered to this key, and what a link opens.
 *
 * Two doors, one shape at the end of both (CORD-05):
 *
 * - **Direct Invites** are indexed, which is the whole point of their outer `k`
 *   tag: one filter finds exactly the invites p-tagged at this key, instead of
 *   decrypting a whole giftwrap inbox to discover there were none.
 * - **A link** is passive — it sits on relays until someone fetches it. Opening
 *   one is a read and nothing else: no join, no subscription, no announcement
 *   until the reader says so.
 *
 * Nothing here writes. Accepting is `concord-join.ts`.
 */

import {
  parseDirectInviteRumor,
  unwrapDirectInvite,
  type InviteDecryptor,
} from "@/lib/concord/direct-invite";
import type { InviteStanding } from "@/lib/concord/invite";
import {
  InviteError,
  inviteExpired,
  parseBundleEvent,
  parseInviteLink,
  STOCK_RELAYS,
  type InviteBundle,
} from "@/lib/concord/invite";
import {
  KIND_DIRECT_INVITE,
  KIND_INVITE_BUNDLE,
  KIND_WRAP,
} from "@/lib/concord/kinds";
import { capRelays } from "@/lib/concord/types";
import { requestEvents } from "@/lib/relay-subscription";
import { loadStoredCommunities } from "@/services/concord-communities";
import eventStore from "@/services/event-store";
import { selectRelaysForFilter } from "@/services/relay-selection";
import type { NostrEvent } from "@/types/nostr";

/**
 * How many wraps to pull, and how many to actually open.
 *
 * Anyone can address a kind-1059 with `["k","3313"]` at any pubkey, and each
 * one costs TWO signer round-trips to peel — which on a bunker is two prompts.
 * So the inbox is bounded twice: a modest fetch, and a hard cap on how many of
 * the newest are opened. A stranger filling an inbox costs a bounded number of
 * refusals, never a prompt storm.
 */
const MAX_INVITE_WRAPS = 60;
const MAX_INVITE_UNWRAPS = 20;

/** The NIP-17 DM relay list — where a Direct Invite is delivered first. */
const KIND_DM_RELAYS = 10050;
/** NIP-65, whose read markers are the fallback rendezvous. */
const KIND_RELAY_LIST = 10002;

/**
 * Where an invite addressed to this key can be found.
 *
 * CORD-05 §6 fixes the delivery target, and a scanner MUST resolve it the same
 * way a sender does or the two never meet: the recipient's kind-10050 DM relays
 * when they publish one, their NIP-65 read relays otherwise — and when they
 * have published neither, the stock set every Concord client ships (the same
 * table CORD-05 §3's dictionary defines, and the only rendezvous available when
 * a member advertises nowhere).
 *
 * The lists are FETCHED rather than read from the store: this runs the moment a
 * reader opens the panel, and a list that has not been loaded yet would resolve
 * to the wrong set silently — which looks exactly like having no invites.
 */
async function inviteScanRelays(pubkey: string): Promise<string[]> {
  const filter = {
    kinds: [KIND_DM_RELAYS, KIND_RELAY_LIST],
    authors: [pubkey],
    limit: 4,
  };
  const { relays } = await selectRelaysForFilter(eventStore, filter);
  const fetched = await requestEvents(relays, [filter]).catch(() => []);
  const stored = [
    eventStore.getReplaceable(KIND_DM_RELAYS, pubkey),
    eventStore.getReplaceable(KIND_RELAY_LIST, pubkey),
  ].filter((e): e is NostrEvent => !!e);
  const all = [...fetched, ...stored];
  const latest = (kind: number) =>
    all
      .filter((e) => e.kind === kind)
      .sort((a, b) => b.created_at - a.created_at)[0];

  const dm = (latest(KIND_DM_RELAYS)?.tags ?? [])
    .filter((t) => t[0] === "relay" && typeof t[1] === "string")
    .map((t) => t[1]);
  if (dm.length > 0) return capRelays(dm);

  // NIP-65: an unmarked entry is read AND write, so only "write" is excluded.
  const reads = (latest(KIND_RELAY_LIST)?.tags ?? [])
    .filter((t) => t[0] === "r" && typeof t[1] === "string" && t[2] !== "write")
    .map((t) => t[1]);
  if (reads.length > 0) return capRelays(reads);

  // Neither published: the stock set is the only place sender and scanner can
  // agree on, and it is fallback ONLY — a member with a list is never also
  // scanned there.
  return [...STOCK_RELAYS];
}

/** One invite, as something a reader can look at before deciding. */
export interface PendingInvite {
  /** Stable identity for the row: the wrap that carried it, or the link. */
  id: string;
  bundle: InviteBundle;
  /** The proven inviter (a Direct Invite's seal author); absent for a link. */
  sender?: string;
  /** When it was sealed, epoch seconds. NIP-59 tweaks this into the past. */
  createdAt: number;
  /** Past its shelf life: the preview still renders, joining refuses. */
  expired: boolean;
  /** The vault already holds this community. Re-resolved by the viewer. */
  alreadyJoined: boolean;
  /** Set by the viewer against the live vault (`inviteStanding`). */
  standing?: InviteStanding;
  /** Where this one came from, for the row's explanation. */
  source: "direct" | "link";
}

/**
 * Every Direct Invite waiting for this key, newest per community.
 *
 * A community already joined is kept and FLAGGED rather than dropped: an invite
 * from someone who does not know you are in already is worth showing as such,
 * and a bundle for a community you hold at an older epoch is how a stranded
 * member is healed.
 */
export async function readDirectInvites(
  pubkey: string,
  signer: InviteDecryptor,
): Promise<PendingInvite[]> {
  if (!signer.nip44) return [];
  const filter = {
    kinds: [KIND_WRAP],
    "#p": [pubkey],
    "#k": [String(KIND_DIRECT_INVITE)],
    limit: MAX_INVITE_WRAPS,
  };
  const relays = await inviteScanRelays(pubkey);
  const wraps = (await requestEvents(relays, [filter]))
    // Newest first, so the cap below drops the oldest rather than whichever
    // order a relay happened to answer in.
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, MAX_INVITE_UNWRAPS);

  const joined = new Set(
    (await loadStoredCommunities(pubkey).catch(() => [])).map((c) => c.idHex),
  );
  const now = Date.now();
  const newest = new Map<string, PendingInvite>();
  for (const wrap of wraps) {
    const unwrapped = await unwrapDirectInvite(wrap as NostrEvent, signer);
    if (!unwrapped) continue;
    const bundle = parseDirectInviteRumor(
      unwrapped.rumor.kind,
      unwrapped.rumor.content,
    );
    if (!bundle) continue;
    const invite: PendingInvite = {
      id: wrap.id,
      bundle,
      sender: unwrapped.sender,
      // The RUMOR's timestamp: the wrap's is tweaked into the past by NIP-59,
      // so ordering rows by it would shuffle them at random.
      createdAt: unwrapped.rumor.created_at,
      expired: inviteExpired(bundle, now),
      alreadyJoined: joined.has(bundle.community_id.toLowerCase()),
      source: "direct",
    };
    const prev = newest.get(bundle.community_id.toLowerCase());
    if (!prev || invite.createdAt > prev.createdAt) {
      newest.set(bundle.community_id.toLowerCase(), invite);
    }
  }
  return [...newest.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Open an invite link: decode it, fetch the bundle it names, decrypt it.
 *
 * The token never leaves this client — it rides the URL's fragment, which no
 * server ever sees — and the coordinate is fetched from the link's own
 * bootstrap relays, since a community's relays are only known once the bundle
 * is open.
 */
export async function openInviteLink(
  url: string,
  pubkey?: string,
): Promise<PendingInvite> {
  const link = parseInviteLink(url);
  if (!link) {
    throw new InviteError("bad-link", "that is not a Concord invite link");
  }
  const filter = {
    kinds: [KIND_INVITE_BUNDLE],
    authors: [link.linkSigner],
    "#d": [""],
    limit: 1,
  };
  const events = await requestEvents(link.bootstrapRelays, [filter]);
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
  if (!newest) {
    throw new InviteError(
      "bad-bundle",
      "no bundle at this link's coordinate — the relays it names may be unreachable",
    );
  }
  const bundle = parseBundleEvent(
    newest as NostrEvent,
    link.linkSigner,
    link.token,
  );
  const joined = pubkey
    ? new Set(
        (await loadStoredCommunities(pubkey).catch(() => [])).map(
          (c) => c.idHex,
        ),
      )
    : new Set<string>();
  return {
    id: newest.id,
    bundle,
    createdAt: newest.created_at,
    expired: inviteExpired(bundle),
    alreadyJoined: joined.has(bundle.community_id.toLowerCase()),
    source: "link",
  };
}
