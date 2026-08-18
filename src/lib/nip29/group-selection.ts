/**
 * Naming one NIP-29 group.
 *
 * Its own module rather than a second export from the list component: a group
 * id is only unique within the relay hosting it, so the pair travels together
 * through the sidebar, the window props and the timeline key — and a component
 * file that also exports helpers loses fast refresh.
 */

export interface GroupSelection {
  groupId: string;
  relayUrl: string;
}

export function groupKey(selection: GroupSelection): string {
  return `${selection.relayUrl}'${selection.groupId}`;
}

/**
 * The typed form of the pair: `[wss://]relay'group-id`.
 *
 * The apostrophe is the separator because neither half can contain one — a
 * relay URL cannot, and a relay assigning a group id with one would be naming
 * something no client could address. `wss://` is optional and assumed; `ws://`
 * is accepted here because a group can legitimately be read over plaintext,
 * and it is the AV endpoint alone that refuses one.
 */
export function parseGroupSelection(input: string): GroupSelection | null {
  const match = input.trim().match(/^((?:wss?:\/\/)?[^']+)'([^']+)$/);
  if (!match) return null;
  const [, host] = match;
  const relayUrl =
    host.startsWith("ws://") || host.startsWith("wss://")
      ? host
      : `wss://${host}`;
  return { groupId: match[2], relayUrl };
}
