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
import {
  Hand,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  Phone,
  PhoneOff,
  SmilePlus,
  Video,
  VideoOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
  setCameraEnabled,
  setHandRaised,
  setMicEnabled,
  setScreenShareEnabled,
} from "@/services/concord-call";
import { EmojiPickerDialog } from "@/components/chat/EmojiPickerDialog";
import { resolveChannel } from "@/services/concord-channel-resolve";
import { CallAudio } from "@/components/call/CallAudio";
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

/** Screensharing needs an API Safari on iOS and most mobiles do not have. */
const canShareScreen =
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getDisplayMedia === "function";

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

  const isThisCall = call.channelIdHex === channelId || channelId === undefined;
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

      {/* The audio sinks live outside the stage: a tile unmounts whenever the
          roster changes shape, and taking the <audio> element with it would cut
          the speaker off mid-sentence. */}
      {connected && <CallAudio />}

      {/* The controls sit above the join button and stay put, so the row does
          not reshuffle under the cursor the moment a call connects — and so
          what a call offers is legible before joining one. Off the call they
          are inert: there is no room to publish into. */}
      <div className="flex flex-col items-center gap-2 border-t p-2">
        <div className="flex items-center gap-1.5">
          <Toggle
            on={call.micEnabled}
            disabled={!connected}
            onClick={() => void setMicEnabled(!call.micEnabled)}
            title={call.micEnabled ? "Mute" : "Unmute"}
            OnIcon={Mic}
            OffIcon={MicOff}
          />
          <Toggle
            on={call.cameraEnabled}
            disabled={!connected}
            onClick={() => void setCameraEnabled(!call.cameraEnabled)}
            title={
              call.cameraEnabled ? "Stop your camera" : "Start your camera"
            }
            OnIcon={Video}
            OffIcon={VideoOff}
          />
          {canShareScreen && (
            <Toggle
              on={call.screenEnabled}
              disabled={!connected}
              onClick={() => void setScreenShareEnabled(!call.screenEnabled)}
              title={
                call.screenEnabled
                  ? "Stop sharing your screen"
                  : "Share a screen"
              }
              OnIcon={Monitor}
              OffIcon={Monitor}
            />
          )}
          <Toggle
            on={call.handRaised}
            disabled={!connected}
            onClick={() => setHandRaised(!call.handRaised)}
            title={call.handRaised ? "Lower your hand" : "Raise your hand"}
            OnIcon={Hand}
            OffIcon={Hand}
          />
          <Toggle
            on={false}
            disabled={!connected}
            onClick={() => setPickerOpen(true)}
            title="Float an emoji at everyone"
            OnIcon={SmilePlus}
            OffIcon={SmilePlus}
          />
        </div>

        {connected ? (
          <Button
            size="sm"
            variant="destructive"
            className="w-40"
            onClick={() => void leaveCall()}
          >
            <PhoneOff className="size-4" />
            Leave
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-40"
            disabled={
              busy ||
              joining ||
              !callsSupported() ||
              !target ||
              !account?.signer
            }
            onClick={() => void join()}
          >
            {busy || joining ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Phone className="size-4" />
            )}
            {joining
              ? "Joining…"
              : fold.present.length > 0
                ? "Join call"
                : "Start a call"}
          </Button>
        )}
      </div>

      <EmojiPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onEmojiSelect={(emoji) => {
          // Unicode only: a NIP-30 custom emoji is a URL the receiver would
          // have to fetch, and a reaction that arrives after it has already
          // floated away is worse than one that never arrived.
          sendReaction(emoji);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function Toggle({
  on,
  disabled,
  onClick,
  title,
  OnIcon,
  OffIcon,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  OnIcon: typeof Mic;
  OffIcon: typeof Mic;
}) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <Button
      size="icon"
      variant={on ? "default" : "outline"}
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "Join the call first" : title}
      className="size-8"
    >
      <Icon className="size-4" />
    </Button>
  );
}
