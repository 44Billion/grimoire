/**
 * How a private conversation is named in the sidebar arrangement store.
 *
 * The same `(protocol, container, channel)` shape `chatReads` uses for a DM —
 * protocol `nip-17`, one container called `dm`, the conversation id as the
 * channel — so a pin, a mute and a read cursor all name the same thing the
 * same way.
 */

import type { RowRef } from "@/hooks/useConcordPrefs";

export const dmRowRef = (conversationId: string): RowRef => [
  "nip-17",
  "dm",
  conversationId,
];
