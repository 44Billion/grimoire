/**
 * Live call presence for the UI (CORD-07 §4).
 *
 * Two shapes, one subscription underneath: the open channel's full fold (who is
 * in the call, which identity they claim, whose hand is up) and a per-channel
 * head count for the sidebar. `watchChannelVoice` refcounts by channel address,
 * so watching every channel of a community costs one REQ per relay in total.
 */

import { useEffect, useMemo, useState } from "react";

import type { Channel } from "@/lib/concord/types";
import { EMPTY_VOICE_FOLD, type VoicePresenceFold } from "@/lib/concord/voice";
import { watchChannelVoice } from "@/services/concord-presence";

/** Who is in this channel's call, updating as heartbeats arrive and go stale. */
export function useChannelVoice(
  relays: readonly string[],
  channel: Channel | undefined,
): VoicePresenceFold {
  const [fold, setFold] = useState<VoicePresenceFold>(EMPTY_VOICE_FOLD);
  // The relay list is rebuilt on every fold of the community; keying the effect
  // on the array identity would tear the subscription down and up again for a
  // set that never changed.
  const relayKey = relays.join(",");

  useEffect(() => {
    if (!channel) {
      setFold(EMPTY_VOICE_FOLD);
      return;
    }
    return watchChannelVoice(relayKey ? relayKey.split(",") : [], channel, {
      onFold: setFold,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayKey, channel?.idHex, channel?.current.group.pk]);

  return fold;
}

/**
 * How many members are in each channel's call, for the sidebar.
 *
 * Every readable channel is watched, not just the open one — a call you cannot
 * see is a call you never join, and the whole point of announcing presence over
 * the channel is that it is cheap to observe.
 */
export function useCommunityVoiceCounts(
  relays: readonly string[],
  channels: readonly Channel[],
): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const relayKey = relays.join(",");
  // Identity of the watched set: channel ids paired with the epoch address the
  // presence rides, so a rekey re-subscribes and a reorder does not.
  const channelKey = channels
    .map((ch) => `${ch.idHex}:${ch.current.group.pk}`)
    .join(",");

  useEffect(() => {
    if (channels.length === 0) {
      setCounts(new Map());
      return;
    }
    const urls = relayKey ? relayKey.split(",") : [];
    const stops = channels.map((channel) =>
      watchChannelVoice(urls, channel, {
        onFold: (fold) =>
          setCounts((prev) => {
            const now = fold.present.length;
            if ((prev.get(channel.idHex) ?? 0) === now) return prev;
            const next = new Map(prev);
            if (now === 0) next.delete(channel.idHex);
            else next.set(channel.idHex, now);
            return next;
          }),
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayKey, channelKey]);

  return counts;
}

/** The authors in a fold, for a roster that renders members rather than tiles. */
export function useVoiceAuthors(fold: VoicePresenceFold): string[] {
  return useMemo(() => fold.present.map((p) => p.author), [fold]);
}
