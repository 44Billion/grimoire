/**
 * The call — one per app, and not owned by any window (CORD-07).
 *
 * A window is the wrong owner here. `ConcordViewer` and the call window both
 * unmount on a workspace switch while their windows still exist in the layout
 * tree, so a `Room` held in React state would drop the call every time the user
 * flips desktops. The room, the heartbeat and the key sync therefore live at
 * module level, and the window is a VIEW of them: it hangs up when its window
 * leaves `state.windows`, never when the component unmounts.
 *
 * What this owes the protocol:
 *
 * - **§2** the token comes from a blind broker, authorized by a grant signed
 *   with the channel-derived `voice_key.sk`. It is never re-minted while
 *   connected: the broker-assigned identity keys our frames and rides our
 *   presence, so a remint would silently change who we are mid-call.
 * - **§3** media is end-to-end encrypted under per-sender keys nobody exchanges.
 *   Every participant's key is derived from the identity the SFU presents; an
 *   identity presence cannot vouch for gets random bytes instead, so its tracks
 *   never decode (§7's client-side discipline, and the only one a blind SFU
 *   allows).
 * - **§4** we announce ourselves every 30 seconds and say `left` on the way out.
 * - **§5** we join the broker the room is already on, and migrate if a split
 *   puts us on the losing side of the tie-break.
 * - **§7** a rekey moves the call, and a ban, a removal or a deleted channel
 *   ends it.
 */

import { atom, getDefaultStore } from "jotai";
import {
  BaseKeyProvider,
  isE2EESupported,
  Room,
  RoomEvent,
  VideoPresets,
  type RoomOptions,
} from "livekit-client";

import { grimoireStateAtom } from "@/core/state";
import { decideCallSync } from "@/lib/concord/call-sync";
import { random32, voiceSenderKey } from "@/lib/concord/derive";
import type { StreamSigner } from "@/lib/concord/stream";
import type { Channel, Community } from "@/lib/concord/types";
import {
  fetchAvTokenFromAny,
  heartbeatDelayMs,
  migrationTarget,
  probeAvBroker,
  rendezvousCandidates,
  verifiedAuthorOf,
  type AvToken,
  type VoicePresenceFold,
} from "@/lib/concord/voice";
import { releaseWire, retainWire } from "@/hooks/useConcordWire";
import {
  publishPresence,
  watchChannelVoice,
} from "@/services/concord-presence";
import { preferredBrokers } from "@/services/concord-brokers";

export type CallStatus =
  | "idle"
  /** Probing brokers and minting a token (§2/§5). */
  | "joining"
  | "connected"
  | "failed";

export interface CallState {
  status: CallStatus;
  communityIdHex?: string;
  channelIdHex?: string;
  channelName?: string;
  /** The broker that actually minted our token — what rides our presence (§5). */
  broker?: string;
  /** Our own SFU identity. Keys our frames; never re-minted while connected. */
  identity?: string;
  micEnabled: boolean;
  handRaised: boolean;
  error?: string;
  /** Who is in the call, as presence tells it. */
  fold: VoicePresenceFold;
  /** The window that owns this call; it ends when that window is closed. */
  windowId?: string;
}

const IDLE: CallState = {
  status: "idle",
  micEnabled: false,
  handRaised: false,
  fold: { present: [], claims: new Map() },
};

/** The UI's view of the call. Written only by this module. */
export const callStateAtom = atom<CallState>(IDLE);

interface ActiveCall {
  community: Community;
  channel: Channel;
  pubkey: string;
  signer: StreamSigner;
  token: AvToken;
  room: Room;
  keyProvider: SenderKeyProvider;
  worker: Worker;
  releasePresence: () => void;
  releaseWindows: () => void;
  heartbeat?: ReturnType<typeof setTimeout>;
  /** Identity → what we last installed for it, so key writes stay idempotent. */
  applied: Map<string, "sender" | "blocked">;
  /** Brokers this call has already tried and left; never migrate back (§5). */
  triedBrokers: Set<string>;
  /** Set while a rejoin or a migration is in flight, so nothing races it. */
  moving: boolean;
}

let active: ActiveCall | undefined;

function store() {
  return getDefaultStore();
}

function patch(over: Partial<CallState>): void {
  store().set(callStateAtom, { ...store().get(callStateAtom), ...over });
}

/**
 * The per-sender key provider (§3), configured to CORD-07's profile.
 *
 * These four options ARE the interop contract — armada uses exactly these, and a
 * single difference means two clients sit in one room and decode nothing from
 * each other, with no error anywhere:
 *
 * - `sharedKey: false` — keys are per participant identity;
 * - `keySize: 256` — AES-256-GCM (LiveKit defaults to 128);
 * - `ratchetWindowSize: 0` and `failureTolerance: -1` — the keys are EXTERNALLY
 *   derived, so LiveKit's auto-ratchet-on-decode-failure must never fire; if it
 *   did, every receiver would silently diverge from the deterministic
 *   derivation and stay diverged.
 */
class SenderKeyProvider extends BaseKeyProvider {
  constructor() {
    super({
      sharedKey: false,
      ratchetWindowSize: 0,
      failureTolerance: -1,
      keySize: 256,
    });
  }

  /** Install `material` as `identity`'s frame-key material (the HKDF input). */
  async setSenderMaterial(
    material: Uint8Array,
    identity: string,
  ): Promise<void> {
    const key = await crypto.subtle.importKey(
      "raw",
      material.slice().buffer as ArrayBuffer,
      "HKDF",
      false,
      ["deriveBits", "deriveKey"],
    );
    this.onSetEncryptionKey(key, identity);
  }
}

/** Whether this browser can encrypt media at all. Without it we do not join. */
export function callsSupported(): boolean {
  return isE2EESupported();
}

/**
 * Join the call in a channel.
 *
 * Leaves any call already running first — one at a time, because the media
 * devices and the roster both assume it.
 */
export async function joinCall(opts: {
  community: Community;
  channel: Channel;
  pubkey: string;
  signer: StreamSigner;
  windowId?: string;
}): Promise<void> {
  if (!callsSupported()) {
    // CORD-07 §3 makes E2EE a MUST and defines no plaintext fallback, so a
    // browser without insertable streams does not get a degraded call.
    patch({
      status: "failed",
      error:
        "This browser cannot encrypt call media, and Concord calls are never sent unencrypted.",
    });
    return;
  }
  await leaveCall();

  const { community, channel } = opts;
  patch({
    status: "joining",
    communityIdHex: community.idHex,
    channelIdHex: channel.idHex,
    channelName: channel.name,
    error: undefined,
    micEnabled: false,
    handRaised: false,
    ...(opts.windowId !== undefined ? { windowId: opts.windowId } : {}),
  });

  try {
    await connect(opts, new Set());
  } catch (error) {
    patch({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    await leaveCall();
  }
}

/** Resolve a broker, mint, connect, and start announcing ourselves. */
async function connect(
  opts: {
    community: Community;
    channel: Channel;
    pubkey: string;
    signer: StreamSigner;
    windowId?: string;
  },
  tried: Set<string>,
): Promise<void> {
  const { community, channel } = opts;
  const room = channel.voice.room;

  // §5: join the call where it already is. The fold we have been watching from
  // the sidebar is the input, so this needs no round trip of its own.
  const seed = currentFold(channel);
  const candidates = rendezvousCandidates(
    room.pk,
    seed,
    preferredBrokers(),
  ).filter((origin) => !tried.has(origin));
  if (candidates.length === 0) {
    throw new Error("No voice broker left to try for this channel.");
  }

  // Probe first (§5), but never let a probe be the last word: a broker can
  // answer its capability endpoint and still refuse to mint, so the mint itself
  // falls through the remaining candidates.
  const reachable: string[] = [];
  for (const origin of candidates) {
    if (await probeAvBroker(origin)) reachable.push(origin);
  }
  const token = await fetchAvTokenFromAny(
    reachable.length > 0 ? reachable : candidates,
    room,
  );

  const keyProvider = new SenderKeyProvider();
  // A static URL, so the bundler can see the worker. A template literal here
  // builds in dev and silently fails to bundle for production.
  const worker = new Worker(
    new URL("livekit-client/e2ee-worker", import.meta.url),
    { type: "module" },
  );
  const options: RoomOptions = {
    adaptiveStream: true,
    dynacast: true,
    e2ee: { keyProvider, worker },
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    publishDefaults: {
      videoSimulcastLayers: [
        VideoPresets.h180,
        VideoPresets.h360,
        VideoPresets.h720,
      ],
      screenShareEncoding: VideoPresets.h1080.encoding,
    },
  };
  const lkRoom = new Room(options);

  const call: ActiveCall = {
    community,
    channel,
    pubkey: opts.pubkey,
    signer: opts.signer,
    token,
    room: lkRoom,
    keyProvider,
    worker,
    releasePresence: () => {},
    releaseWindows: () => {},
    applied: new Map(),
    triedBrokers: new Set([...tried, token.origin]),
    moving: false,
  };
  active = call;

  // Our own key first: E2EE is only enabled once we can encrypt, or the first
  // frames we publish go out under no key at all.
  await keyProvider.setSenderMaterial(
    voiceSenderKey(channel.voice.mediaKey, token.identity),
    token.identity,
  );
  call.applied.set(token.identity, "sender");

  lkRoom.on(RoomEvent.ParticipantConnected, () => syncKeys(call));
  lkRoom.on(RoomEvent.Disconnected, () => {
    // A disconnect we did not ask for. Nothing here retries: the SFU token is
    // single-use and re-minting would change our identity mid-call, which is
    // exactly what §4's verification rule reads as an impostor.
    if (active === call && !call.moving)
      void leaveCall("The call disconnected.");
  });

  await lkRoom.connect(token.url, token.token);
  await lkRoom.setE2EEEnabled(true);
  // Joined muted. A call that starts hot publishes a room before its member has
  // decided to speak in it.
  await lkRoom.localParticipant.setMicrophoneEnabled(false);

  // Presence: both what we read (verification, rendezvous, §7) and, through the
  // heartbeat below, what we say.
  call.releasePresence = watchChannelVoice(community.relays, channel, {
    onFold: (fold) => {
      if (active !== call) return;
      patch({ fold });
      syncKeys(call);
      void maybeMigrate(call, fold);
    },
  });
  // The heartbeat publishes through the wire's own sockets, so the call holds
  // the wire open for as long as it runs — a Concord window closing must not
  // silently stop us announcing ourselves.
  retainWire();
  call.releaseWindows = watchOwningWindow(call);

  patch({
    status: "connected",
    broker: token.origin,
    identity: token.identity,
    error: undefined,
  });
  beat(call);
}

/** The presence we already hold for a channel, without opening anything. */
function currentFold(channel: Channel): VoicePresenceFold {
  const seen = store().get(callStateAtom);
  return seen.channelIdHex === channel.idHex
    ? seen.fold
    : { present: [], claims: new Map() };
}

/**
 * Give every participant their key (§3), and every UNVERIFIED one garbage.
 *
 * A member can copy another's SFU identity into their own `joined`; §4 says a
 * contested claim proves nothing about either author. Handing such an identity
 * random bytes means its tracks simply fail to decode — the §7 discipline, and
 * the only enforcement available when the SFU cannot be told anything.
 */
function syncKeys(call: ActiveCall): void {
  if (active !== call) return;
  const fold = store().get(callStateAtom).fold;
  const identities = new Set<string>([call.token.identity]);
  for (const p of call.room.remoteParticipants.values())
    identities.add(p.identity);
  // Pre-warm from presence, so audio decodes from the first frame after a
  // track subscribes rather than after the next fold.
  for (const p of fold.present) identities.add(p.identity);

  for (const identity of identities) {
    const verified =
      identity === call.token.identity ||
      Boolean(verifiedAuthorOf(fold, identity));
    const want = verified ? "sender" : "blocked";
    if (call.applied.get(identity) === want) continue;
    call.applied.set(identity, want);
    const material = verified
      ? voiceSenderKey(call.channel.voice.mediaKey, identity)
      : random32();
    void call.keyProvider
      .setSenderMaterial(material, identity)
      .catch(() => undefined);
  }
}

/** Announce ourselves now, and schedule the next beat (§4). */
function beat(call: ActiveCall): void {
  if (active !== call) return;
  void publishPresence({
    relays: call.community.relays,
    channel: call.channel,
    pubkey: call.pubkey,
    signer: call.signer,
    status: "joined",
    identity: call.token.identity,
    broker: call.token.origin,
    hand: store().get(callStateAtom).handRaised,
  }).catch(() => undefined);
  clearTimeout(call.heartbeat);
  call.heartbeat = setTimeout(() => beat(call), heartbeatDelayMs());
}

/** Republish off-cycle — a hand raised or lowered should not wait 30s. */
function announceNow(): void {
  if (active) beat(active);
}

/** §5 split healing: move to the origin the tie-break says the call is on. */
async function maybeMigrate(
  call: ActiveCall,
  fold: VoicePresenceFold,
): Promise<void> {
  if (active !== call || call.moving) return;
  const target = migrationTarget(
    call.channel.voice.room.pk,
    fold,
    call.token.origin,
    call.triedBrokers,
  );
  if (!target) return;
  call.moving = true;
  const tried = new Set(call.triedBrokers);
  const opts = {
    community: call.community,
    channel: call.channel,
    pubkey: call.pubkey,
    signer: call.signer,
    ...(store().get(callStateAtom).windowId !== undefined
      ? { windowId: store().get(callStateAtom).windowId as string }
      : {}),
  };
  await teardown(call, { announceLeave: true });
  try {
    await connect(opts, tried);
  } catch {
    // The winner would not have us. We are already out of the old room, so say
    // so rather than pretending to still be in it.
    patch({ status: "failed", error: "Could not move to the call's broker." });
  }
}

/**
 * Hang up when the owning WINDOW is gone — removed from state, not unmounted.
 *
 * `state.windows` is a flat record across every workspace, so this is one
 * membership test and is workspace-independent. Keying off unmount instead
 * would end the call on a workspace switch, which is the one thing a
 * module-level call exists to survive.
 */
function watchOwningWindow(call: ActiveCall): () => void {
  const windowId = store().get(callStateAtom).windowId;
  if (!windowId) return () => {};
  return store().sub(grimoireStateAtom, () => {
    if (active !== call) return;
    const state = store().get(grimoireStateAtom);
    if (!(windowId in state.windows)) void leaveCall();
  });
}

/** Mic on or off. The only publish this phase makes. */
export async function setMicEnabled(on: boolean): Promise<void> {
  if (!active) return;
  await active.room.localParticipant.setMicrophoneEnabled(on);
  patch({ micEnabled: on });
}

/** Raise or lower a hand — sticky state, carried on every heartbeat. */
export function setHandRaised(raised: boolean): void {
  if (!active) return;
  patch({ handRaised: raised });
  announceNow();
}

/** Leave the call, best-effort announcing it (§4: a missed `left` heals). */
export async function leaveCall(error?: string): Promise<void> {
  const call = active;
  if (!call) {
    if (error) patch({ status: "failed", error });
    return;
  }
  await teardown(call, { announceLeave: true });
  store().set(callStateAtom, {
    ...IDLE,
    ...(error !== undefined ? { status: "failed", error } : {}),
  });
}

async function teardown(
  call: ActiveCall,
  opts: { announceLeave: boolean },
): Promise<void> {
  if (active === call) active = undefined;
  clearTimeout(call.heartbeat);
  call.releaseWindows();
  if (opts.announceLeave) {
    await publishPresence({
      relays: call.community.relays,
      channel: call.channel,
      pubkey: call.pubkey,
      signer: call.signer,
      status: "left",
    }).catch(() => undefined);
  }
  call.releasePresence();
  releaseWire();
  try {
    await call.room.disconnect();
  } catch {
    // Already gone.
  }
  call.room.removeAllListeners();
  call.worker.terminate();
}

/**
 * §7, live: compare the call's join-time coordinates against the vault and the
 * Control fold, and stay, rejoin the rotated room, or hang up.
 *
 * Called by the viewer, which is what actually holds live community state.
 */
export async function syncCall(input: {
  listLoaded: boolean;
  community: Community | undefined;
  folded: Parameters<typeof decideCallSync>[0]["folded"];
  channels: readonly Channel[];
  selfBanned: boolean;
}): Promise<void> {
  const call = active;
  if (!call || call.moving) return;
  const decision = decideCallSync({
    snapshot: {
      channelIdHex: call.channel.idHex,
      epoch: call.channel.current.epoch,
      roomPk: call.channel.voice.room.pk,
    },
    ...input,
  });
  if (decision.action === "stay") return;

  if (decision.action === "leave") {
    const why =
      decision.reason === "banned"
        ? "You were banned from this community."
        : decision.reason === "removed"
          ? "You are no longer a member of this community."
          : "This channel is gone.";
    await leaveCall(why);
    return;
  }

  // A rekey rolled the room out from under us. The rotation that severs a
  // removed member from chat has to move the call too, or everyone stays in the
  // room that member can still derive.
  call.moving = true;
  const opts = {
    community: decision.community,
    channel: decision.channel,
    pubkey: call.pubkey,
    signer: call.signer,
  };
  await teardown(call, { announceLeave: true });
  patch({ status: "joining", channelIdHex: decision.channel.idHex });
  try {
    await connect(opts, new Set());
  } catch (error) {
    patch({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The live room, for the components that render its tracks. */
export function activeRoom(): Room | undefined {
  return active?.room;
}

/** Test seam. */
export function _activeCallForTests(): ActiveCall | undefined {
  return active;
}
