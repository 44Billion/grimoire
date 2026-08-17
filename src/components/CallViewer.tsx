/**
 * The call window (CORD-07).
 *
 * A view of the app's single call, never its owner: the room lives in
 * `concord-call.ts`, so switching workspaces — which unmounts this — does not
 * end the call. Closing the WINDOW does, and the service watches the layout
 * state for that.
 *
 * The roster renders whether or not you are in the call. Presence is announced
 * over the channel and costs nothing to read (§4), so who is talking is
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
  Phone,
  PhoneOff,
  ShieldAlert,
  Volume2,
} from "lucide-react";

import { UserName } from "@/components/nostr/UserName";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/hooks/useAccount";
import { useChannelVoice } from "@/hooks/useConcordVoice";
import type { Channel, Community } from "@/lib/concord/types";
import { verifiedAuthorOf, type VoicePresenceFold } from "@/lib/concord/voice";
import { cn } from "@/lib/utils";
import {
  callStateAtom,
  callsSupported,
  joinCall,
  leaveCall,
  setHandRaised,
  setMicEnabled,
} from "@/services/concord-call";
import { resolveChannel } from "@/services/concord-channel-resolve";
import { CallAudio } from "@/components/call/CallAudio";
import { useRoomSpeakers } from "@/components/call/useRoomSpeakers";

interface CallViewerProps {
  /** community_id (lowercase hex). */
  communityId?: string;
  /** channel_id (lowercase hex). */
  channelId?: string;
  windowId?: string;
}

const EMPTY_RELAYS: string[] = [];

export function CallViewer({
  communityId,
  channelId,
  windowId,
}: CallViewerProps) {
  const call = useAtomValue(callStateAtom);
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

      {(joinError ?? (isThisCall ? call.error : undefined)) && (
        <div className="border-b px-3 py-1.5 text-xs text-destructive">
          {joinError ?? call.error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <Tiles
          fold={fold}
          {...(connected && call.identity
            ? { ownIdentity: call.identity }
            : {})}
          speaking={speaking}
          muted={muted}
          connected={connected}
          supported={callsSupported()}
          hasTarget={Boolean(target)}
        />
      </div>

      {/* The audio sinks live outside the tile grid: a tile unmounts whenever
          the roster changes shape, and taking the <audio> element with it would
          cut the speaker off mid-sentence. */}
      {connected && <CallAudio />}

      <div className="flex items-center justify-center gap-2 border-t p-2">
        {connected ? (
          <>
            <Button
              size="sm"
              variant={call.micEnabled ? "default" : "outline"}
              onClick={() => void setMicEnabled(!call.micEnabled)}
              title={call.micEnabled ? "Mute" : "Unmute"}
            >
              {call.micEnabled ? (
                <Mic className="size-4" />
              ) : (
                <MicOff className="size-4" />
              )}
            </Button>
            <Button
              size="sm"
              variant={call.handRaised ? "default" : "outline"}
              onClick={() => setHandRaised(!call.handRaised)}
              title={call.handRaised ? "Lower your hand" : "Raise your hand"}
            >
              <Hand className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void leaveCall()}
              title="Leave the call"
            >
              <PhoneOff className="size-4" />
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={
              busy ||
              joining ||
              !callsSupported() ||
              !target ||
              !account?.signer
            }
            onClick={() => void join()}
          >
            {(busy || joining) && <Loader2 className="size-3 animate-spin" />}
            {joining
              ? "Joining…"
              : fold.present.length > 0
                ? "Join call"
                : "Start a call"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * One tile per member presence proves (§4).
 *
 * An SFU participant nobody's fresh presence claims — or one two members claim
 * at once — renders as unverified and stays silent: its frames are keyed with
 * random bytes, so they never decode.
 *
 * Speaking and muted come from the SFU rather than from presence, because they
 * are properties of media nothing on a relay can see. They therefore only show
 * while we are actually in the room; from outside, a roster is all there is.
 */
function Tiles({
  fold,
  ownIdentity,
  speaking,
  muted,
  connected,
  supported,
  hasTarget,
}: {
  fold: VoicePresenceFold;
  ownIdentity?: string;
  speaking: Set<string>;
  muted: Set<string>;
  connected: boolean;
  supported: boolean;
  hasTarget: boolean;
}) {
  if (fold.present.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        <p className="max-w-sm">
          {!supported
            ? "This browser cannot encrypt call media, and a Concord call is never sent unencrypted."
            : !hasTarget
              ? "No channel. Open one and press the phone in its header."
              : connected
                ? "Nobody else is here yet."
                : "Nobody is in this call. Anyone holding the channel's key can start one — the broker is told nothing about the community, and it only ever forwards ciphertext."}
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
      {fold.present.map((p) => {
        const verified = verifiedAuthorOf(fold, p.identity) === p.author;
        const isSpeaking = connected && speaking.has(p.identity);
        const isMuted = connected && muted.has(p.identity);
        return (
          <div
            key={`${p.author}:${p.identity}`}
            className={cn(
              "flex flex-col items-center gap-1 rounded border p-3 transition-colors",
              p.identity === ownIdentity && "border-primary/60",
              // The speaking ring is the only thing in this window that moves
              // on its own, which is what makes it readable at a glance.
              isSpeaking && "border-primary bg-primary/10",
              !verified && "opacity-70",
            )}
          >
            <UserName pubkey={p.author} className="truncate text-sm" />
            <div className="flex items-center gap-1 text-muted-foreground">
              {isSpeaking && <Volume2 className="size-3.5 text-primary" />}
              {isMuted && !isSpeaking && <MicOff className="size-3.5" />}
              {p.hand && <Hand className="size-3.5" />}
              {!verified && (
                <span
                  className="flex items-center gap-0.5 text-[10px]"
                  title="Two members claim this SFU identity, or nobody does. Its audio is never decoded."
                >
                  <ShieldAlert className="size-3.5" />
                  unverified
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
