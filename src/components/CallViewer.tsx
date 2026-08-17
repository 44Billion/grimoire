/**
 * The call window (CORD-07).
 *
 * A view of the app's single call, never its owner: the room lives in
 * `concord-call.ts`, so switching workspaces — which unmounts this — does not
 * end the call. Closing the WINDOW does, and the service watches the layout
 * state for that.
 *
 * Nothing survives a reload but the window itself, so a remounted window with no
 * call running renders idle: it names the channel it was on and offers to
 * rejoin, rather than pretending to still be connected.
 */

import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import {
  Hand,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  ShieldAlert,
} from "lucide-react";

import { UserName } from "@/components/nostr/UserName";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/hooks/useAccount";
import { verifiedAuthorOf } from "@/lib/concord/voice";
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

interface CallViewerProps {
  /** community_id (lowercase hex). */
  communityId?: string;
  /** channel_id (lowercase hex). */
  channelId?: string;
  windowId?: string;
}

export function CallViewer({
  communityId,
  channelId,
  windowId,
}: CallViewerProps) {
  const call = useAtomValue(callStateAtom);
  const { account } = useAccount();
  const [joinError, setJoinError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [channelName, setChannelName] = useState<string>();

  // The window's own coordinates, so an idle window can still say what it is
  // for. A call in progress names itself.
  const showing = call.status !== "idle" ? call.channelIdHex : channelId;
  const isThisCall = call.channelIdHex === channelId || channelId === undefined;

  useEffect(() => {
    if (!communityId || !channelId) return;
    let cancelled = false;
    void resolveChannel(communityId, channelId)
      .then(({ channel }) => {
        if (!cancelled) setChannelName(channel.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [communityId, channelId]);

  const join = useCallback(async () => {
    if (!communityId || !channelId || !account?.signer) return;
    setBusy(true);
    setJoinError(undefined);
    try {
      const { community, channel } = await resolveChannel(
        communityId,
        channelId,
      );
      await joinCall({
        community,
        channel,
        pubkey: account.pubkey,
        signer: account.signer,
        ...(windowId !== undefined ? { windowId } : {}),
      });
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [communityId, channelId, account, windowId]);

  const connected = call.status === "connected" && isThisCall;
  const joining = call.status === "joining" && isThisCall;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 items-center gap-1.5 border-b px-2">
        <Headphones className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">
          {call.channelName ?? channelName ?? "Call"}
        </span>
        {connected && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {call.fold.present.length}
          </span>
        )}
      </div>

      {(joinError ?? call.error) && (
        <div className="border-b px-3 py-1.5 text-xs text-destructive">
          {joinError ?? call.error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {connected || joining ? (
          <Tiles fold={call.fold} ownIdentity={call.identity} />
        ) : (
          <Idle
            hasTarget={Boolean(communityId && channelId && showing)}
            supported={callsSupported()}
          />
        )}
      </div>

      {/* The audio sinks live outside the tile grid: a tile can unmount as the
          roster changes, and taking the <audio> element with it would cut the
          speaker off mid-sentence. */}
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
              !communityId ||
              !channelId ||
              !account?.signer
            }
            onClick={() => void join()}
          >
            {(busy || joining) && <Loader2 className="size-3 animate-spin" />}
            {joining ? "Joining…" : "Join call"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Idle({
  hasTarget,
  supported,
}: {
  hasTarget: boolean;
  supported: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <p className="max-w-sm">
        {!supported
          ? "This browser cannot encrypt call media, and a Concord call is never sent unencrypted."
          : hasTarget
            ? "Not in this call. Anyone holding the channel's key can join — the broker is told nothing about the community, and it only ever forwards ciphertext."
            : "No call. Open a channel and press the headset in its header."}
      </p>
    </div>
  );
}

/**
 * One tile per member presence proves (§4).
 *
 * An SFU participant nobody's fresh presence claims — or one two members claim
 * at once — renders as unverified and stays silent: its frames are keyed with
 * random bytes, so they never decode.
 */
function Tiles({
  fold,
  ownIdentity,
}: {
  fold: { present: Array<{ author: string; identity: string; hand: boolean }> };
  ownIdentity?: string;
}) {
  if (fold.present.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Nobody else is here yet.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
      {fold.present.map((p) => {
        const verified =
          verifiedAuthorOf(fold as never, p.identity) === p.author;
        return (
          <div
            key={`${p.author}:${p.identity}`}
            className={cn(
              "flex flex-col items-center gap-1 rounded border p-3",
              p.identity === ownIdentity && "border-primary/60",
              !verified && "opacity-70",
            )}
          >
            <UserName pubkey={p.author} className="truncate text-sm" />
            <div className="flex items-center gap-1 text-muted-foreground">
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
