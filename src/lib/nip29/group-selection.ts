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

/**
 * The same pair, read from a command line the palette has already tokenized.
 *
 * `'` is a QUOTE character to `shell-quote`, so `relay.example.com'pizza`
 * reaches a parser as two tokens with the separator gone. Rejoining them is not
 * optional decoration: without it the documented syntax silently resolves to
 * something else entirely. `chat` has carried this rejoin since NIP-29 landed;
 * this is the shared version of it.
 *
 * A single token is tried as-is first, so a quoted argument still works.
 */
export function parseGroupArgs(args: readonly string[]): GroupSelection | null {
  const first = args[0];
  if (!first) return null;
  const direct = parseGroupSelection(first);
  if (direct) return direct;
  // Only when the first token looks like a host and carries no separator of its
  // own — otherwise a two-word community name would be read as a group.
  if (args.length === 2 && first.includes(".") && !first.includes("'")) {
    return parseGroupSelection(`${first}'${args[1]}`);
  }
  return null;
}
