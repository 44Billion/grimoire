/**
 * The call window for a NIP-29 group's AV space.
 *
 * A view of the app's single call, never its owner: the room lives in
 * `nip29-call.ts`, so switching workspaces — which unmounts this — does not end
 * the call. Closing the WINDOW does, and the service watches the layout state
 * for that.
 *
 * The roster renders whether or not you are in the call, because `kind:39004`
 * costs nothing to read and who is in a room is what decides whether to join it.
 * What it cannot show from outside is who is SPEAKING: that is a property of
 * media, and only the SFU sees it.
 *
 * No raised hand and no floating emoji. Both ride Concord's presence rumors, and
 * a relay group has no carrier for them — the relay publishes the roster and
 * nothing else. A button that could never do anything would be worse than its
 * absence.
 */

import { useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { Phone } from "lucide-react";

import { CallControls } from "@/components/call/CallControls";
import { CallStage } from "@/components/call/CallStage";
import { useRoomSpeakers } from "@/components/call/useRoomSpeakers";
import { useRoomTracks } from "@/components/call/useRoomTracks";
import { useAccount } from "@/hooks/useAccount";
import { useGroupMetadata } from "@/hooks/useGroupMetadata";
import { useGroupParticipants } from "@/hooks/useNip29Participants";
import { EMPTY_ROSTER, type CallReaction } from "@/lib/call/roster";
import { foldGroupRoster } from "@/lib/nip29/livekit";
import { cn } from "@/lib/utils";
import {
  setCameraEnabled,
  setMicEnabled,
  setScreenShareEnabled,
} from "@/services/call-room";
import { callStateAtom, isGroupCall } from "@/services/call-state";

const EMPTY_REACTIONS: CallReaction[] = [];

interface Nip29CallViewerProps {
  /** The relay hosting the group. */
  relayUrl?: string;
  /** The group id, verbatim. */
  groupId?: string;
  windowId?: string;
}

export function Nip29CallViewer({
  relayUrl,
  groupId,
  windowId,
}: Nip29CallViewerProps) {
  const call = useAtomValue(callStateAtom);
  const { account } = useAccount();
  const [joinError, setJoinError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const metadata = useGroupMetadata(groupId ?? "", relayUrl ?? "");
  const name = metadata?.name || groupId || "Space";

  const isThisCall = isGroupCall(call, relayUrl, groupId);
  const connected = call.status === "connected" && isThisCall;
  const joining = call.status === "joining" && isThisCall;

  // Watched whether or not we are in the call. Once connected the service's own
  // fold is the fresher one — it also knows the room's participants, which the
  // relay's list can lag.
  const watched = useGroupParticipants(relayUrl, groupId);
  const outside = useMemo(
    () => (watched.length > 0 ? foldGroupRoster(watched, []) : EMPTY_ROSTER),
    [watched],
  );
  const fold = connected ? call.fold : outside;

  const { speaking, muted } = useRoomSpeakers(call.roomEpoch);
  const tracks = useRoomTracks(call.roomEpoch);

  const join = useCallback(async () => {
    if (!relayUrl || !groupId || !account?.signer) return;
    setBusy(true);
    setJoinError(undefined);
    try {
      // Imported here rather than at the top: this window is the only thing in
      // the app that starts a group call, and the media stack is a large chunk
      // that a reader who never joins one should not download.
      const { joinGroupCall } = await import("@/services/nip29-call");
      await joinGroupCall({
        relayUrl,
        groupId,
        groupName: name,
        pubkey: account.pubkey,
        signer: account.signer,
        ...(windowId !== undefined ? { windowId } : {}),
      });
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [relayUrl, groupId, name, account, windowId]);

  const leave = useCallback(() => {
    void import("@/services/nip29-call").then((s) => s.leaveGroupCall());
  }, []);

  const error = joinError ?? (isThisCall ? call.error : undefined);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 items-center gap-1.5 border-b px-2">
        <Phone
          className={cn(
            "size-3.5 shrink-0",
            connected ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="truncate text-sm">{name}</span>
        {fold.present.length > 0 && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {fold.present.length}
          </span>
        )}
      </div>

      {error && (
        <div className="border-b px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <CallStage
          fold={fold}
          {...(connected && call.identity
            ? { ownIdentity: call.identity }
            : {})}
          speaking={speaking}
          muted={muted}
          tracks={tracks}
          reactions={EMPTY_REACTIONS}
          connected={connected}
          // There is no E2EE to be unsupported: the relay issuing the token is
          // the relay that already reads the group.
          supported
          hasTarget={Boolean(relayUrl && groupId)}
        />
      </div>

      <CallControls
        connected={connected}
        joining={busy || joining}
        micEnabled={call.micEnabled}
        cameraEnabled={call.cameraEnabled}
        screenEnabled={call.screenEnabled}
        onMic={(on) => void setMicEnabled(on)}
        onCamera={(on) => void setCameraEnabled(on)}
        onScreen={(on) => void setScreenShareEnabled(on)}
        onJoin={() => void join()}
        onLeave={leave}
        canJoin={Boolean(relayUrl && groupId && account?.signer)}
        joinLabel={fold.present.length > 0 ? "Join space" : "Start the space"}
      />
    </div>
  );
}
