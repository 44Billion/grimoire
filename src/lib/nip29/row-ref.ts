/**
 * How a NIP-29 group is named in the sidebar arrangement store.
 *
 * The same `(protocol, container, channel)` shape `chatReads` uses for a group —
 * the relay is the CONTAINER, exactly as a Concord community is, because a group
 * id is only unique within the relay hosting it and pinning `bitcoin` on one
 * relay must not pin the unrelated `bitcoin` on another.
 *
 * Its own module rather than an export from the list component so the sidebar
 * heading can ask whether a row is muted without importing a component — the
 * reason `dm/row-ref.ts` exists too.
 */

import type { RowRef } from "@/hooks/useConcordPrefs";
import type { GroupSelection } from "@/lib/nip29/group-selection";

export const groupRowRef = (group: GroupSelection): RowRef => [
  "nip-29",
  group.relayUrl,
  group.groupId,
];
