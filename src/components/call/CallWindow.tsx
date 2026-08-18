/**
 * Which call window a `call` window is.
 *
 * One appId holds two spaces — a Concord channel's call and a NIP-29 group's —
 * because to the reader they are the same window: one pill, one room, one set
 * of controls. The dispatch lives here rather than in `WindowRenderer` so that
 * file keeps one branch per appId, and so both viewers stay behind a single
 * lazy boundary.
 *
 * A window saved before relay groups were callable carries no `protocol`, and
 * it was a Concord call.
 */

import { lazy } from "react";

const CallViewer = lazy(() =>
  import("@/components/CallViewer").then((m) => ({ default: m.CallViewer })),
);
const Nip29CallViewer = lazy(() =>
  import("@/components/Nip29CallViewer").then((m) => ({
    default: m.Nip29CallViewer,
  })),
);

export interface CallWindowProps {
  protocol?: "concord" | "nip-29";
  communityId?: string;
  channelId?: string;
  relayUrl?: string;
  groupId?: string;
  windowId: string;
}

export function CallWindow({
  protocol,
  communityId,
  channelId,
  relayUrl,
  groupId,
  windowId,
}: CallWindowProps) {
  // No Suspense of its own: `WindowRenderer` already wraps every window in one,
  // and a second boundary here would only swap which spinner shows.
  return protocol === "nip-29" ? (
    <Nip29CallViewer
      relayUrl={relayUrl}
      groupId={groupId}
      windowId={windowId}
    />
  ) : (
    <CallViewer
      communityId={communityId}
      channelId={channelId}
      windowId={windowId}
    />
  );
}
