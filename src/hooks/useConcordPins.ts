/**
 * The verified pins of one channel (CORD-04 §7).
 *
 * Two states this must keep apart, because §7 hangs a rule on the distinction:
 * a channel with NO pins, and a pin list this member cannot open — sealed under
 * a channel key epoch they never held. An empty view and an unopenable one look
 * identical, so the unreadable case is reported as such and rendered as
 * unavailable.
 *
 * Verification is per entry and never partial: an entry that fails any step of
 * §7 is dropped, so what comes back is only what this client proved for itself.
 */

import { useMemo } from "react";

import {
  openSealedPinList,
  parsePinListContent,
  verifyPinEntries,
  type VerifiedPin,
} from "@/lib/concord/pins";
import type { FoldedControl } from "@/lib/concord/control";
import type { Channel } from "@/lib/concord/types";

export interface ConcordPins {
  /** Proven pins, newest first. */
  pins: VerifiedPin[];
  /** A list exists but this member's keys cannot open it. */
  unavailable: boolean;
}

const NONE: ConcordPins = { pins: [], unavailable: false };

export function useConcordPins(
  folded: FoldedControl | undefined,
  channel: Channel | undefined,
): ConcordPins {
  const content = channel ? folded?.pins.get(channel.idHex) : undefined;
  return useMemo(() => {
    if (!content || !channel) return NONE;
    const parsed = parsePinListContent(content);
    if (parsed.form === "unreadable") return { pins: [], unavailable: true };

    let entries: unknown[];
    if (parsed.form === "public") {
      entries = parsed.entries;
    } else {
      // The sealed form names its epoch; only the key for THAT epoch opens it,
      // and a member who joined after the rotation holds none.
      const stream = channel.streams.find((s) => s.epoch === parsed.epoch);
      const opened = stream
        ? openSealedPinList(parsed.sealed, stream.group.convKey)
        : undefined;
      if (!opened) return { pins: [], unavailable: true };
      entries = opened;
    }

    const pins = verifyPinEntries(entries, channel.idHex);
    return {
      pins: pins.sort((a, b) => b.createdAt - a.createdAt),
      unavailable: false,
    };
  }, [content, channel]);
}
