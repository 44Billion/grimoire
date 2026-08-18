/**
 * Where each CHAT window is, in each community.
 *
 * This used to be one device-wide preference. Every open window read and wrote
 * the same entry, so two windows could not sit in two channels: opening a
 * second one landed it wherever the first had been left, and switching
 * communities in either took both to the same place. A window is a viewport,
 * not the device — the cursor belongs to it.
 *
 * In memory, not persisted, and deliberately not cleaned up on close: the
 * channel a window is ACTUALLY on lives in that window's props, which is what
 * survives a reload. This only answers "where was this window last, in a
 * community it has since navigated away from" — worth nothing after a reload,
 * and a handful of hex strings while the session lasts.
 */
const cursors = new Map<string, string>();

const key = (windowId: string, communityIdHex: string) =>
  `${windowId}:${communityIdHex.toLowerCase()}`;

/** The channel this window was last on in this community, if any. */
export function windowCursor(
  windowId: string | undefined,
  communityIdHex: string | undefined,
): string | undefined {
  if (!windowId || !communityIdHex) return undefined;
  return cursors.get(key(windowId, communityIdHex));
}

/**
 * Record a deliberate move. Only ever called from a click — a fallback
 * resolution must not write here, or the first channel of a community whose
 * fold had not landed yet becomes the one the reader chose.
 */
export function setWindowCursor(
  windowId: string | undefined,
  communityIdHex: string | undefined,
  channelIdHex: string,
): void {
  if (!windowId || !communityIdHex) return;
  cursors.set(key(windowId, communityIdHex), channelIdHex);
}

/** Test seam. */
export function clearWindowCursors(): void {
  cursors.clear();
}
