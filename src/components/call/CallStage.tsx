/**
 * The stage: one tile per member presence proves, and a spotlight for a screen.
 *
 * A tile is a MEMBER, not an SFU participant. An identity nobody's fresh
 * presence claims — or one two members claim at once — renders unverified and
 * stays dark: its frames are keyed with random bytes, so they never decode
 * (CORD-07 §4/§7). That is the only enforcement a blind SFU allows, and it is
 * why an unverified tile shows no picture rather than a picture nobody vouched
 * for.
 *
 * Speaking, muted and the video itself come from the SFU rather than presence,
 * because they are properties of media no relay ever sees — so they show only
 * while we are in the room. From outside, the roster is all there is, which is
 * still enough to decide whether to join.
 */

import {
  Hand,
  MicOff,
  MonitorUp,
  ShieldAlert,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useState } from "react";

import { CustomEmoji } from "@/components/nostr/CustomEmoji";
import { UserName } from "@/components/nostr/UserName";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { applyVolumes } from "@/services/call-room";
import { setVolumeFor, volumeFor } from "@/services/concord-devices";
import { VideoSurface } from "@/components/call/VideoSurface";
import type { IdentityTracks } from "@/components/call/useRoomTracks";
import {
  verifiedAuthorOf,
  type VoicePresenceFold,
  type VoiceReactionEntry,
} from "@/lib/concord/voice";
import { cn } from "@/lib/utils";

export interface StageProps {
  fold: VoicePresenceFold;
  /** Reactions in the air, floated over whoever sent them. */
  reactions: VoiceReactionEntry[];
  ownIdentity?: string;
  speaking: Set<string>;
  muted: Set<string>;
  tracks: Map<string, IdentityTracks>;
  connected: boolean;
  supported: boolean;
  hasTarget: boolean;
  /**
   * What an empty stage says, when the truthful answer is protocol-specific.
   *
   * The default is CORD-07's, and it is a claim: nobody is here, anyone with
   * the channel key can start a call, and the broker learns nothing. None of
   * that is true of a relay group, where the relay runs the room and decides
   * who may enter — so a caller that is not Concord says its own thing rather
   * than inheriting a sentence about a broker it does not have.
   */
  emptyNote?: string;
  /** What to say when there is no room to be in yet. */
  noTargetNote?: string;
}

export function CallStage(props: StageProps) {
  const { fold, tracks } = props;
  if (fold.present.length === 0) return <EmptyStage {...props} />;

  // At most one screen is spotlighted: two people sharing at once is rare, and
  // the alternative — shrinking every screen to a thumbnail — makes the one
  // thing anyone is looking at unreadable. The first sharer in roster order
  // wins, which is stable across clients because the fold's order is.
  //
  // Gated on verification exactly as a tile's camera is. An identity two
  // members claim — or none does — is keyed with random bytes and decodes to
  // nothing, so an impostor publishing a screenshare would otherwise take the
  // whole stage for a black frame and label it with somebody else's name.
  const shared = fold.present.find(
    (p) =>
      tracks.get(p.identity)?.screen &&
      verifiedAuthorOf(fold, p.identity) === p.author,
  );
  const screen = shared ? tracks.get(shared.identity)?.screen : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {screen && shared && (
        <div className="relative min-h-0 flex-1 overflow-hidden rounded border bg-black">
          <VideoSurface track={screen} contain />
          <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 text-[11px]">
            <MonitorUp className="size-3" />
            <UserName pubkey={shared.author} className="text-[11px]" />
          </div>
        </div>
      )}
      <div
        className={cn(
          "grid gap-2",
          screen
            ? "shrink-0 grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]"
            : "min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]",
        )}
      >
        {fold.present.map((p) => (
          <Tile
            key={`${p.author}:${p.identity}`}
            present={p}
            {...props}
            compact={Boolean(screen)}
          />
        ))}
      </div>
    </div>
  );
}

function Tile({
  present,
  fold,
  ownIdentity,
  speaking,
  muted,
  tracks,
  reactions,
  connected,
  compact,
}: StageProps & {
  present: VoicePresenceFold["present"][number];
  compact: boolean;
}) {
  const verified = verifiedAuthorOf(fold, present.identity) === present.author;
  const isSpeaking = connected && speaking.has(present.identity);
  const isMuted = connected && muted.has(present.identity);
  const isSelf = present.identity === ownIdentity;
  const camera = verified ? tracks.get(present.identity)?.camera : undefined;
  const mine = reactions.filter((r) => r.author === present.author);
  // Re-read on every change so the icon follows the choice; the store is the
  // authority, this is only what makes the row repaint.
  const [, bumpVolume] = useState(0);
  const volume = volumeFor(present.author);
  const setVolume = (next: number) => {
    setVolumeFor(present.author, next);
    applyVolumes();
    bumpVolume((n) => n + 1);
  };

  const tile = (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded border transition-colors",
        compact ? "aspect-video" : "aspect-video min-h-24",
        camera ? "bg-black" : "gap-1 bg-muted/20 p-3",
        isSelf && "border-primary/60",
        // The speaking ring is the only thing on this stage that moves on its
        // own, which is what makes it readable at a glance.
        isSpeaking && "border-primary ring-1 ring-primary",
        !verified && "opacity-70",
      )}
    >
      {mine.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center gap-1">
          {mine.map((r) => (
            // Keyed by nonce, which is what makes each one fire exactly once:
            // a replay of the same reaction re-uses the key and never mounts a
            // second animation.
            <span key={r.nonce} className="animate-in fade-in text-2xl">
              {r.custom ? (
                <CustomEmoji
                  shortcode={r.custom.shortcode}
                  url={r.custom.url}
                  size="md"
                />
              ) : (
                r.emoji
              )}
            </span>
          ))}
        </div>
      )}
      {camera ? (
        <>
          {/* Our own camera is mirrored, the way every other client shows it:
              an unmirrored self-view reads as someone else's picture. */}
          <VideoSurface track={camera} mirror={isSelf} />
          <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 text-[11px]">
            {isSpeaking && <Volume2 className="size-3 text-primary" />}
            {isMuted && !isSpeaking && <MicOff className="size-3" />}
            <UserName pubkey={present.author} className="text-[11px]" />
            {present.hand && <Hand className="size-3" />}
          </div>
        </>
      ) : (
        <>
          <UserName pubkey={present.author} className="truncate text-sm" />
          <div className="flex items-center gap-1 text-muted-foreground">
            {isSpeaking && <Volume2 className="size-3.5 text-primary" />}
            {isMuted && !isSpeaking && <MicOff className="size-3.5" />}
            {volume === 0 && <VolumeX className="size-3.5" />}
            {volume > 0 && volume < 1 && <Volume1 className="size-3.5" />}
            {present.hand && <Hand className="size-3.5" />}
            {!verified && (
              <span
                className="flex items-center gap-0.5 text-[10px]"
                title="Two members claim this SFU identity, or nobody does. Nothing it publishes is ever decoded."
              >
                <ShieldAlert className="size-3.5" />
                unverified
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );

  // The only moderation a blind SFU allows (§7): nothing signed can mute
  // anyone, so what a client can do is decline to play what arrives. Local,
  // never published, and it tells the member nothing.
  if (isSelf) return tile;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tile}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => setVolume(0)}>
          <VolumeX className="mr-2 size-4" />
          Silence here
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => setVolume(0.5)}>
          <Volume1 className="mr-2 size-4" />
          Half volume
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => setVolume(1)}>
          <Volume2 className="mr-2 size-4" />
          As published
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function EmptyStage({
  supported,
  hasTarget,
  connected,
  emptyNote,
  noTargetNote,
}: Pick<
  StageProps,
  "supported" | "hasTarget" | "connected" | "emptyNote" | "noTargetNote"
>) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <p className="max-w-sm">
        {!supported
          ? "This browser cannot encrypt call media, and a Concord call is never sent unencrypted."
          : !hasTarget
            ? (noTargetNote ??
              "No channel. Open one and press the phone in its header.")
            : connected
              ? "Nobody else is here yet."
              : (emptyNote ??
                "Nobody is in this call. Anyone holding the channel's key can start one — the broker is told nothing about the community, and it only ever forwards ciphertext.")}
      </p>
    </div>
  );
}
