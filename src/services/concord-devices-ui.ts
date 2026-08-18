/**
 * The device picker's side of `concord-devices.ts`.
 *
 * Split out so Settings never imports the room module — which pulls in
 * `livekit-client` and its worker, a chunk nobody who only opened Settings
 * should download. The switch is therefore done through a dynamic import, and
 * only when a call is actually running.
 */

export {
  denoiseEnabled,
  listDevices,
  preferredCameraId,
  preferredMicId,
  setPreferredCameraId,
  setPreferredMicId,
} from "@/services/concord-devices";

import {
  setDenoiseEnabled,
  setPreferredCameraId,
  setPreferredMicId,
} from "@/services/concord-devices";

/**
 * Remember a device choice, and apply it to a call in progress.
 *
 * `undefined` clears the choice back to the system default; a live call keeps
 * whatever it already captured until it next opens the device, which is the
 * same thing every other client does.
 */
export async function chooseCaptureDevice(
  kind: "audioinput" | "videoinput",
  deviceId?: string,
): Promise<void> {
  if (kind === "audioinput") setPreferredMicId(deviceId);
  else setPreferredCameraId(deviceId);
  if (!deviceId) return;
  const { activeRoom, switchCaptureDevice } =
    await import("@/services/call-room");
  if (!activeRoom()) return;
  await switchCaptureDevice(kind, deviceId);
}

/** Remember the noise-suppression choice, and apply it to a call in progress. */
export async function setDenoise(on: boolean): Promise<void> {
  setDenoiseEnabled(on);
  const { activeRoom, applyDenoise } = await import("@/services/call-room");
  if (!activeRoom()) return;
  await applyDenoise();
}
