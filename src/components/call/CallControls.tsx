/**
 * The row under a call: what you are publishing, and the way in or out.
 *
 * Shared by both call windows because the media half is identical — there is
 * one room, one microphone and one camera, whoever minted the token. What is
 * NOT shared is what rides a protocol's own presence: raising a hand and
 * floating an emoji are Concord extensions carried on a presence rumor, and a
 * relay group has no carrier for either. They are optional here rather than
 * disabled, because a button that can never do anything is worse than no
 * button.
 *
 * The toggles stay mounted and inert off the call, so the row does not reshuffle
 * under the cursor the moment one connects — and so what a call offers is
 * legible before joining it.
 */

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

/** Screensharing needs an API Safari on iOS and most mobiles do not have. */
const canShareScreen =
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getDisplayMedia === "function";

export interface CallControlsProps {
  connected: boolean;
  joining: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  onMic: (on: boolean) => void;
  onCamera: (on: boolean) => void;
  onScreen: (on: boolean) => void;
  onJoin: () => void;
  onLeave: () => void;
  /** False while anything the join needs is missing — a signer, a target. */
  canJoin: boolean;
  /** "Join call" when somebody is already in, "Start a call" when nobody is. */
  joinLabel: string;
  /** Concord only: sticky raised-hand state carried on every heartbeat. */
  hand?: { raised: boolean; onToggle: () => void };
  /** Concord only: opens the emoji picker. */
  onReact?: () => void;
}

export function CallControls({
  connected,
  joining,
  micEnabled,
  cameraEnabled,
  screenEnabled,
  onMic,
  onCamera,
  onScreen,
  onJoin,
  onLeave,
  canJoin,
  joinLabel,
  hand,
  onReact,
}: CallControlsProps) {
  return (
    <div className="flex flex-col items-center gap-2 border-t p-2">
      <div className="flex items-center gap-1.5">
        <Toggle
          on={micEnabled}
          disabled={!connected}
          onClick={() => onMic(!micEnabled)}
          title={micEnabled ? "Mute" : "Unmute"}
          OnIcon={Mic}
          OffIcon={MicOff}
        />
        <Toggle
          on={cameraEnabled}
          disabled={!connected}
          onClick={() => onCamera(!cameraEnabled)}
          title={cameraEnabled ? "Stop your camera" : "Start your camera"}
          OnIcon={Video}
          OffIcon={VideoOff}
        />
        {canShareScreen && (
          <Toggle
            on={screenEnabled}
            disabled={!connected}
            onClick={() => onScreen(!screenEnabled)}
            title={
              screenEnabled ? "Stop sharing your screen" : "Share a screen"
            }
            OnIcon={Monitor}
            OffIcon={Monitor}
          />
        )}
        {hand && (
          <Toggle
            on={hand.raised}
            disabled={!connected}
            onClick={hand.onToggle}
            title={hand.raised ? "Lower your hand" : "Raise your hand"}
            OnIcon={Hand}
            OffIcon={Hand}
          />
        )}
        {onReact && (
          <Toggle
            on={false}
            disabled={!connected}
            onClick={onReact}
            title="Float an emoji at everyone"
            OnIcon={SmilePlus}
            OffIcon={SmilePlus}
          />
        )}
      </div>

      {connected ? (
        <Button
          size="sm"
          variant="destructive"
          className="w-40"
          onClick={onLeave}
        >
          <PhoneOff className="size-4" />
          Leave
        </Button>
      ) : (
        <Button
          size="sm"
          className="w-40"
          disabled={!canJoin || joining}
          onClick={onJoin}
        >
          {joining ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Phone className="size-4" />
          )}
          {joining ? "Joining…" : joinLabel}
        </Button>
      )}
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
