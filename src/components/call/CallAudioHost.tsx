/**
 * Where the call's speakers live: the app shell, not the call window.
 *
 * A window unmounts on a workspace switch while its call keeps running, and an
 * `<audio>` element that leaves with it takes the sound with it — the call is
 * still connected, still publishing, and silent. Mounting the sinks in the shell
 * is what makes "the call follows you" true of the audio and not just the pill.
 *
 * The shell is in the app's first load, so the part that actually touches
 * `livekit-client` is lazily imported and only while a call is connected. This
 * component itself knows nothing about media.
 */

import { useAtomValue } from "jotai";
import { lazy, Suspense } from "react";

import { callStateAtom } from "@/services/concord-call-state";

const CallAudio = lazy(() => import("@/components/call/CallAudio"));

export function CallAudioHost() {
  const status = useAtomValue(callStateAtom).status;
  if (status !== "connected") return null;
  return (
    <Suspense fallback={null}>
      <CallAudio />
    </Suspense>
  );
}
