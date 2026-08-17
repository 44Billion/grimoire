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
  type VoiceReactionEntry,
} from "@/lib/concord/voice";
import { releaseWire, retainWire } from "@/hooks/useConcordWire";
import {
  publishPresence,
  voicePresenceOf,
  watchChannelVoice,
} from "@/services/concord-presence";
import { preferredBrokers } from "@/services/concord-brokers";
import {
  preferredCameraId,
  preferredMicId,
  setPreferredCameraId,
  setPreferredMicId,
  volumeFor,
} from "@/services/concord-devices";

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
  cameraEnabled: boolean;
  screenEnabled: boolean;
  handRaised: boolean;
  error?: string;
  /** Who is in the call, as presence tells it. */
  fold: VoicePresenceFold;
  /** The window that owns this call; it ends when that window is closed. */
  windowId?: string;
  /**
   * Bumped every time a NEW `Room` is built — a rejoin after a rekey, or a §5
   * migration. Nothing about the call's identity changes, so `status` stays
   * "connected" through a migration and a component watching status alone would
   * keep holding the room that was just torn down. Anything that binds to the
   * room object itself keys on this.
   */
  roomEpoch: number;
}

const IDLE: CallState = {
  status: "idle",
  micEnabled: false,
  cameraEnabled: false,
  screenEnabled: false,
  handRaised: false,
  fold: { present: [], claims: new Map() },
  roomEpoch: 0,
};

/** The UI's view of the call. Written only by this module. */
export const callStateAtom = atom<CallState>(IDLE);

/**
 * Reactions currently in the air.
 *
 * Kept out of `callStateAtom` deliberately: these change several times a second
 * while a call is lively, and every consumer of the call's identity, roster and
 * mute state would re-render with them. Nothing is folded — an entry appears,
 * floats, and is dropped.
 */
export const callReactionsAtom = atom<VoiceReactionEntry[]>([]);

/** How long a reaction floats before it is aged out. */
const REACTION_TTL_MS = 4_000;

let reactionSweep: ReturnType<typeof setInterval> | undefined;

function floatReaction(reaction: VoiceReactionEntry): void {
  store().set(callReactionsAtom, [...store().get(callReactionsAtom), reaction]);
  reactionSweep ??= setInterval(() => {
    const cutoff = Date.now() - REACTION_TTL_MS;
    const live = store()
      .get(callReactionsAtom)
      .filter((r) => r.ms > cutoff);
    store().set(callReactionsAtom, live);
    if (live.length === 0) {
      clearInterval(reactionSweep);
      reactionSweep = undefined;
    }
  }, REACTION_TTL_MS / 4);
}

/**
 * How long a joiner listens before deciding a room is empty.
 *
 * §5 says a full heartbeat interval (30s), because presence is ephemeral and a
 * client that has not been listening knows nothing. A 30-second stare before a
 * click does anything is not a call anyone would make, so this waits for a
 * heartbeat already in flight and otherwise joins — and the split that risks is
 * exactly what the migration below heals.
 */
const EMPTY_ROOM_LISTEN_MS = 1_500;

/** Bound on the goodbye. §4: a missed `left` heals by staleness anyway. */
const LEAVE_ANNOUNCE_MS = 4_000;

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
  /** Whether this call still holds the wire retain. Released exactly once. */
  wireHeld: boolean;
  /** Whether teardown has already run, so it never runs twice. */
  torn: boolean;
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
    cameraEnabled: false,
    screenEnabled: false,
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
  }
}

interface ConnectOptions {
  community: Community;
  channel: Channel;
  pubkey: string;
  signer: StreamSigner;
}

/**
 * Resolve a broker, mint, connect, and start announcing ourselves.
 *
 * Everything acquired here is released here on failure. The two resources that
 * outlive a single statement — the wire retain and the presence subscription —
 * are taken before anything can throw, and ownership of them passes to the
 * `ActiveCall` the moment one exists; after that, teardown is what releases
 * them, exactly once. An earlier version retained the wire only at the very end,
 * so a failed join released a retain it never took and dropped the CHAT wire's
 * sockets for the whole app.
 */
async function connect(
  opts: ConnectOptions,
  tried: Set<string>,
): Promise<void> {
  const { community, channel } = opts;
  const room = channel.voice.room;

  // The heartbeat publishes through the wire's own sockets, so the call holds
  // the wire open for as long as it runs — a Concord window closing must not
  // silently stop us announcing ourselves.
  retainWire();
  // Listen BEFORE choosing a broker. Presence is the §5 rendezvous input and it
  // is ephemeral, so a client that has not been listening knows nothing and
  // heads for its own default — splitting away from a call already running
  // elsewhere. Opening the channel in Concord already holds this; opening the
  // call window straight after a reload does not.
  let call: ActiveCall | undefined;
  const releasePresence = watchChannelVoice(community.relays, channel, {
    onFold: (fold) => {
      if (!call || active !== call) return;
      patch({ fold });
      syncKeys(call);
      applyVolumes();
      void maybeMigrate(call, fold);
    },
    // Our own reactions echo back through the same subscription and animate
    // identically, so there is no optimistic path to keep in step.
    onReaction: (reaction) => {
      if (!call || active !== call) return;
      floatReaction(reaction);
    },
  });
  let owned = true;

  try {
    if (currentFold(channel).present.length === 0) {
      await new Promise((r) => setTimeout(r, EMPTY_ROOM_LISTEN_MS));
    }
    const candidates = rendezvousCandidates(
      room.pk,
      currentFold(channel),
      preferredBrokers(),
    ).filter((origin) => !tried.has(origin));
    if (candidates.length === 0) {
      throw new Error("No voice broker left to try for this channel.");
    }

    // Probe first (§5), but never let a probe be the last word: a broker can
    // answer its capability endpoint and still refuse to mint, so the mint
    // itself falls through the remaining candidates.
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
        ...(preferredMicId() ? { deviceId: preferredMicId() } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      videoCaptureDefaults: {
        ...(preferredCameraId() ? { deviceId: preferredCameraId() } : {}),
        resolution: VideoPresets.h720.resolution,
      },
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

    call = {
      community,
      channel,
      pubkey: opts.pubkey,
      signer: opts.signer,
      token,
      room: lkRoom,
      keyProvider,
      worker,
      releasePresence,
      releaseWindows: () => {},
      applied: new Map(),
      triedBrokers: new Set([...tried, token.origin]),
      moving: false,
      wireHeld: true,
      torn: false,
    };
    active = call;
    owned = false;

    // Our own key first: E2EE is only enabled once we can encrypt, or the first
    // frames we publish go out under no key at all.
    await keyProvider.setSenderMaterial(
      voiceSenderKey(channel.voice.mediaKey, token.identity),
      token.identity,
    );
    call.applied.set(token.identity, "sender");

    const owner = call;
    lkRoom.on(RoomEvent.ParticipantConnected, () => {
      syncKeys(owner);
      applyVolumes();
    });
    lkRoom.on(RoomEvent.Disconnected, () => {
      // A disconnect we did not ask for. Nothing here retries: the SFU token is
      // single-use and re-minting would change our identity mid-call, which is
      // exactly what §4's verification rule reads as an impostor. A disconnect
      // DURING the connect handshake is left to the throw below, which cleans
      // up in one place.
      if (active === owner && !owner.moving && !owner.torn) {
        void leaveCall("The call disconnected.");
      }
    });

    await lkRoom.connect(token.url, token.token);
    await lkRoom.setE2EEEnabled(true);
    // Joined muted. A call that starts hot publishes a room before its member
    // has decided to speak in it.
    await lkRoom.localParticipant.setMicrophoneEnabled(false);

    call.releaseWindows = watchOwningWindow(call);

    patch({
      status: "connected",
      broker: token.origin,
      identity: token.identity,
      error: undefined,
      micEnabled: false,
      cameraEnabled: false,
      screenEnabled: false,
      fold: currentFold(channel),
      roomEpoch: store().get(callStateAtom).roomEpoch + 1,
    });
    syncKeys(call);
    beat(call);
  } catch (error) {
    if (owned) {
      // Nothing took ownership: release exactly what this attempt acquired.
      releasePresence();
      releaseWire();
    } else if (call) {
      // A call object exists, so teardown owns both — and it is idempotent, so
      // a `Disconnected` handler that already ran costs nothing here.
      await teardown(call, { announceLeave: false });
    }
    throw error;
  }
}

/**
 * The presence already known for a channel, read from the shared memory rather
 * than from the call's own state.
 *
 * This is the §5 rendezvous input, and reading it off `callStateAtom` would make
 * it useless: that fold is only populated once a call is CONNECTED, so at join
 * time it is always empty and every join would head for our own default broker,
 * splitting away from a call armada started elsewhere. The presence service has
 * been watching this channel since the sidebar rendered it, and is what knows.
 */
function currentFold(channel: Channel): VoicePresenceFold {
  return voicePresenceOf(channel.current.group.pk);
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
  const fold = currentFold(call.channel);
  const identities = new Set<string>([call.token.identity]);
  for (const p of call.room.remoteParticipants.values()) {
    identities.add(p.identity);
  }
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
  const opts: ConnectOptions = {
    community: call.community,
    channel: call.channel,
    pubkey: call.pubkey,
    signer: call.signer,
  };
  await teardown(call, { announceLeave: true });
  // Say so: a migration rebuilds the room, and anything bound to the old one
  // has to know it is gone rather than reading a status that never changed.
  patch({ status: "joining" });
  try {
    await connect(opts, tried);
  } catch {
    // The winner would not have us. We are already out of the old room, so say
    // so rather than pretending to still be in it.
    patch({
      status: "failed",
      error: "Could not move to the broker this call is on.",
    });
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

/**
 * Publish or stop publishing one of our own tracks.
 *
 * The reported state is read back off LiveKit rather than assumed from the
 * request, so a denied permission — or a screenshare dialog the member
 * cancelled — shows as off instead of a button claiming we are sending
 * something we are not.
 *
 * Video and screenshare need no new keys and no new events (CORD-07 §6): they
 * ride the same room, the same per-sender key and the same presence as the
 * audio.
 */
async function setPublishing(
  source: "mic" | "camera" | "screen",
  on: boolean,
): Promise<void> {
  const call = active;
  if (!call) return;
  const local = call.room.localParticipant;
  try {
    if (source === "mic") await local.setMicrophoneEnabled(on);
    else if (source === "camera") await local.setCameraEnabled(on);
    // The screen's own audio rides with it when the member shares it; it is
    // published as a separate track and mixed by the receiver like any other.
    else await local.setScreenShareEnabled(on, { audio: true });
  } catch (error) {
    patch({
      ...readPublishing(call),
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  patch(readPublishing(call));
}

function readPublishing(call: ActiveCall): Partial<CallState> {
  const local = call.room.localParticipant;
  return {
    micEnabled: local.isMicrophoneEnabled,
    cameraEnabled: local.isCameraEnabled,
    screenEnabled: local.isScreenShareEnabled,
  };
}

/** Mic on or off. */
export async function setMicEnabled(on: boolean): Promise<void> {
  await setPublishing("mic", on);
}

/** Camera on or off (§6 — the same call, the same keys). */
export async function setCameraEnabled(on: boolean): Promise<void> {
  await setPublishing("camera", on);
}

/** Screenshare on or off (§6). */
export async function setScreenShareEnabled(on: boolean): Promise<void> {
  await setPublishing("screen", on);
}

/** Raise or lower a hand — sticky state, carried on every heartbeat. */
export function setHandRaised(raised: boolean): void {
  if (!active) return;
  patch({ handRaised: raised });
  // Off-cycle, so others see it now rather than up to 30 seconds from now.
  beat(active);
}

/**
 * Float an emoji at everyone in the call.
 *
 * An Armada client extension rather than CORD-07, and a deliberately cheap one:
 * it rides an additive `react` tag on an off-cycle presence rumor, which doubles
 * as that member's heartbeat. So it spends no frozen kind, inherits presence's
 * blindness — no relay and no broker sees it — and a client that does not know
 * the tag round-trips it untouched.
 *
 * Fire-and-forget by design: the nonce makes each one fire exactly once at every
 * receiver, and nothing folds it into state. It is never retried, because an
 * emoji that arrives late is worse than one that never arrives.
 */
export function sendReaction(emoji: string): void {
  const call = active;
  if (!call) return;
  const nonce = crypto.randomUUID();
  void publishPresence({
    relays: call.community.relays,
    channel: call.channel,
    pubkey: call.pubkey,
    signer: call.signer,
    status: "joined",
    identity: call.token.identity,
    broker: call.token.origin,
    hand: store().get(callStateAtom).handRaised,
    reaction: { emoji, nonce },
  }).catch(() => undefined);
  // It WAS a heartbeat, so the next one is due a full interval from now rather
  // than on the old schedule — otherwise a run of reactions publishes a beat
  // each, on top of the reactions themselves.
  clearTimeout(call.heartbeat);
  call.heartbeat = setTimeout(() => beat(call), heartbeatDelayMs());
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
    roomEpoch: store().get(callStateAtom).roomEpoch + 1,
    ...(error !== undefined ? { status: "failed", error } : {}),
  });
}

/**
 * Release everything one call holds, exactly once.
 *
 * The room is disconnected FIRST and the goodbye published after. Announcing
 * first means the microphone stays live while a signer decides whether to sign
 * — and on a bunker awaiting manual approval that is an open mic for as long as
 * the person takes. §4 is explicit that a missed `left` heals by staleness, so
 * the ordering costs nothing and the alternative costs privacy.
 */
async function teardown(
  call: ActiveCall,
  opts: { announceLeave: boolean },
): Promise<void> {
  if (call.torn) return;
  call.torn = true;
  if (active === call) active = undefined;
  clearTimeout(call.heartbeat);
  call.releaseWindows();

  try {
    await call.room.disconnect();
  } catch {
    // Already gone.
  }
  call.room.removeAllListeners();
  call.worker.terminate();

  if (opts.announceLeave) {
    await Promise.race([
      publishPresence({
        relays: call.community.relays,
        channel: call.channel,
        pubkey: call.pubkey,
        signer: call.signer,
        status: "left",
      }).catch(() => undefined),
      new Promise((r) => setTimeout(r, LEAVE_ANNOUNCE_MS)),
    ]);
  }

  call.releasePresence();
  if (call.wireHeld) {
    call.wireHeld = false;
    releaseWire();
  }
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
  const opts: ConnectOptions = {
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

/** Switch capture device mid-call, so a choice takes effect without rejoining. */
export async function switchCaptureDevice(
  kind: "audioinput" | "videoinput",
  deviceId: string,
): Promise<void> {
  if (kind === "audioinput") setPreferredMicId(deviceId);
  else setPreferredCameraId(deviceId);
  await active?.room.switchActiveDevice(kind, deviceId).catch(() => undefined);
}

/**
 * Apply this device's per-member volumes to the room (§7).
 *
 * The only moderation a blind SFU allows: nothing signed can mute anyone, so
 * what a client can do is decline to play what it receives. Local, never
 * published, and it says nothing to the member being turned down.
 *
 * Volumes are stored per PUBKEY but applied per SFU IDENTITY, and only for an
 * identity presence actually vouches for — an unverified one is playing nothing
 * decodable anyway, and matching it to a member would be the guess §4 refuses.
 */
export function applyVolumes(): void {
  const call = active;
  if (!call) return;
  const fold = currentFold(call.channel);
  for (const participant of call.room.remoteParticipants.values()) {
    const author = verifiedAuthorOf(fold, participant.identity);
    participant.setVolume(author ? volumeFor(author) : 1);
  }
}
