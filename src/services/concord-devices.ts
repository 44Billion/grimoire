/**
 * Which microphone, which camera, and how loud each member is.
 *
 * All of it is local: none of these choices is published, none reaches a relay,
 * and none is protocol. Per-participant volume in particular is the whole of
 * what CORD-07 §7 leaves a client — the SFU is blind, so no signed edict can
 * mute anyone, and the only lever is refusing to play what arrives.
 *
 * Stored in localStorage rather than Dexie: these are properties of THIS
 * machine's hardware, not of the account, and they should survive a sign-out the
 * way a chosen theme does.
 */

const MIC_KEY = "concord.voice.mic";
const CAMERA_KEY = "concord.voice.camera";
const VOLUME_KEY = "concord.voice.volume";
const DENOISE_KEY = "concord.voice.denoise";

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value?: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // A blocked localStorage costs the preference, never the call.
  }
}

/** The chosen microphone's deviceId, if one was chosen. */
export function preferredMicId(): string | undefined {
  return read(MIC_KEY);
}

/** The chosen camera's deviceId, if one was chosen. */
export function preferredCameraId(): string | undefined {
  return read(CAMERA_KEY);
}

/**
 * Whether to run noise suppression on our own microphone.
 *
 * Defaults ON. It runs before encryption, on the raw capture, so nobody else
 * can tell it is there — which makes it a plain quality setting rather than
 * anything the protocol has an opinion about.
 */
export function denoiseEnabled(): boolean {
  return read(DENOISE_KEY) !== "0";
}

export function setDenoiseEnabled(on: boolean): void {
  write(DENOISE_KEY, on ? "1" : "0");
}

export function setPreferredMicId(deviceId?: string): void {
  write(MIC_KEY, deviceId);
}

export function setPreferredCameraId(deviceId?: string): void {
  write(CAMERA_KEY, deviceId);
}

/**
 * List the input devices this browser will admit to.
 *
 * Labels are empty until the page has been granted permission at least once, so
 * a picker opened before a first call shows "Microphone 1" and friends — which
 * is a browser rule, not something to work around.
 */
export async function listDevices(): Promise<{
  mics: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
}> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      mics: devices.filter((d) => d.kind === "audioinput"),
      cameras: devices.filter((d) => d.kind === "videoinput"),
    };
  } catch {
    return { mics: [], cameras: [] };
  }
}

// ── Per-member volume (§7) ───────────────────────────────────────────────────

/** pubkey → gain, where 0 is locally muted and 1 is as published. */
type VolumeMap = Record<string, number>;

function readVolumes(): VolumeMap {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: VolumeMap = {};
    for (const [pubkey, value] of Object.entries(parsed)) {
      if (typeof value === "number" && value >= 0 && value <= 2) {
        out[pubkey] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

let volumes: VolumeMap | undefined;
const listeners = new Set<() => void>();

function current(): VolumeMap {
  return (volumes ??= readVolumes());
}

/** How loud this member should be here. 1 unless someone said otherwise. */
export function volumeFor(pubkey: string): number {
  return current()[pubkey] ?? 1;
}

/** Every volume that is not the default, for a UI that lists them. */
export function adjustedVolumes(): VolumeMap {
  return { ...current() };
}

/** Set a member's volume locally. `1` restores the default and forgets it. */
export function setVolumeFor(pubkey: string, volume: number): void {
  const next = { ...current() };
  const clamped = Math.max(0, Math.min(2, volume));
  if (clamped === 1) delete next[pubkey];
  else next[pubkey] = clamped;
  volumes = next;
  write(VOLUME_KEY, JSON.stringify(next));
  for (const listener of [...listeners]) listener();
}

/** Notified whenever any member's volume changes. */
export function onVolumesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
