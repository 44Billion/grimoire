/**
 * The call window (CORD-07).
 *
 * A view of the app's single call, never its owner: the room lives in
 * `concord-call.ts`, so switching workspaces — which unmounts this — does not
 * end the call. Closing the WINDOW does, and the service watches the layout
 * state for that.
 *
 * The roster renders whether or not you are in the call. Presence is announced
 * over the channel and costs nothing to read (§4), so who is in a call is
 * something a member can see before deciding to join — which is the whole point
 * of announcing it there rather than asking a server.
 *
 * Nothing survives a reload but the window itself, so a remounted window with no
 * call running renders idle: it names the channel it was on and offers to
 * rejoin, rather than pretending to still be connected.
 */

import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { Phone } from "lucide-react";

import { useAccount } from "@/hooks/useAccount";
import { useChannelVoice } from "@/hooks/useConcordVoice";
import type { Channel, Community } from "@/lib/concord/types";
import type { VoiceReactionEntry } from "@/lib/concord/voice";
import { cn } from "@/lib/utils";
import {
  callReactionsAtom,
  callStateAtom,
  callsSupported,
  joinCall,
  leaveCall,
  sendReaction,
  setHandRaised,
} from "@/services/concord-call";
import {
  setCameraEnabled,
  setMicEnabled,
  setScreenShareEnabled,
} from "@/services/call-room";
import { EmojiPickerDialog } from "@/components/chat/EmojiPickerDialog";
import { resolveChannel } from "@/services/concord-channel-resolve";
import { CallControls } from "@/components/call/CallControls";
import { CallStage } from "@/components/call/CallStage";
import { useRoomSpeakers } from "@/components/call/useRoomSpeakers";
import { useRoomTracks } from "@/components/call/useRoomTracks";

interface CallViewerProps {
  /** community_id (lowercase hex). */
  communityId?: string;
  /** channel_id (lowercase hex). */
  channelId?: string;
  windowId?: string;
}

const EMPTY_RELAYS: string[] = [];
const EMPTY_REACTIONS: VoiceReactionEntry[] = [];

export function CallViewer({
  communityId,
  channelId,
  windowId,
}: CallViewerProps) {
  const call = useAtomValue(callStateAtom);
  const reactions = useAtomValue(callReactionsAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { account } = useAccount();
  const [joinError, setJoinError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{
    community: Community;
    channel: Channel;
  }>();

  useEffect(() => {
    if (!communityId || !channelId) return;
    let cancelled = false;
    void resolveChannel(communityId, channelId)
      .then(({ community, channel }) => {
        if (!cancelled) setTarget({ community, channel });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [communityId, channelId]);

  // Watched whether or not we are in the call, so the roster is readable from
  // the outside. Once connected the service's own fold is the fresher one.
  const watched = useChannelVoice(
    target?.community.relays ?? EMPTY_RELAYS,
    target?.channel,
  );

  // `protocol` first, and it is not a formality: a bare `call` window passes no
  // channel, so without it this window adopts a running NIP-29 space — showing
  // its roster, and offering a Leave that calls a `leaveCall` with nothing to
  // leave.
  const isThisCall =
    call.protocol === "concord" &&
    (call.channelIdHex === channelId || channelId === undefined);
  const connected = call.status === "connected" && isThisCall;
  const joining = call.status === "joining" && isThisCall;
  const fold = connected ? call.fold : watched;
  const { speaking, muted } = useRoomSpeakers(call.roomEpoch);
  const tracks = useRoomTracks(call.roomEpoch);

  const join = useCallback(async () => {
    if (!target || !account?.signer) return;
    setBusy(true);
    setJoinError(undefined);
    try {
      await joinCall({
        community: target.community,
        channel: target.channel,
        pubkey: account.pubkey,
        signer: account.signer,
        ...(windowId !== undefined ? { windowId } : {}),
      });
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [target, account, windowId]);

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
        <span className="truncate text-sm">
          {call.channelName ?? target?.channel.name ?? "Call"}
        </span>
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
          reactions={connected ? reactions : EMPTY_REACTIONS}
          connected={connected}
          supported={callsSupported()}
          hasTarget={Boolean(target)}
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
        onLeave={() => void leaveCall()}
        canJoin={
          Boolean(target) && Boolean(account?.signer) && callsSupported()
        }
        joinLabel={fold.present.length > 0 ? "Join call" : "Start a call"}
        hand={{
          raised: call.handRaised,
          onToggle: () => setHandRaised(!call.handRaised),
        }}
        onReact={() => setPickerOpen(true)}
      />

      <EmojiPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onEmojiSelect={(emoji, custom) => {
          sendReaction(
            emoji,
            custom
              ? { shortcode: custom.shortcode, url: custom.url }
              : undefined,
          );
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
