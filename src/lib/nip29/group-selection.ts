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
