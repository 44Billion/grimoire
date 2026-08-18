import { cn } from "@/lib/utils";

/**
 * Hex, grimoire's assistant.
 *
 * A name and a face rather than "assistant", because the window is a
 * conversation in a client where every other speaker has both. The model and
 * provider still belong to the user's extension — Hex is the seat, not the
 * model, which is why the turn footer still names whatever answered.
 *
 * Assets are vendored under `public/` rather than hotlinked: an identity that
 * only renders when a CDN is reachable is not an identity.
 */
export const HEX_NAME = "Hex";

export type HexFace = "idle" | "working" | "laser";

const FACES: Record<HexFace, string> = {
  idle: "/hex-avatar.png",
  working: "/hex-working.png",
  laser: "/hex-laser.png",
};

export function HexAvatar({
  className,
  face = "idle",
}: {
  className?: string;
  /** `working` while a turn streams; `laser` on hover of an invitation. */
  face?: HexFace;
}) {
  return (
    <img
      alt={face === "working" ? `${HEX_NAME} is working` : HEX_NAME}
      className={cn("size-4 shrink-0 select-none", className)}
      height={16}
      src={FACES[face]}
      width={16}
    />
  );
}

/**
 * Hex as a window/command icon. Shaped like a lucide icon — a component taking
 * `className` — so it drops into the command-icon registry unchanged.
 */
export function HexIcon({ className }: { className?: string }) {
  return <HexAvatar className={className} />;
}

/**
 * Hex with laser eyes on hover. Used where the UI invites you to ask him —
 * the eyes are the affordance, so the swap has to be on the parent's hover.
 */
export function HexHoverAvatar({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-4 shrink-0", className)}>
      {/* `size-full`, not the avatar's own `size-4`: the wrapper is what a caller
          sizes, and an explicit width on a replaced element beats `inset-0`, so
          a `size-3` button was drawing a 16px face inside a 12px box. */}
      <HexAvatar className="absolute inset-0 size-full group-hover:opacity-0" />
      <HexAvatar
        className="absolute inset-0 size-full opacity-0 group-hover:opacity-100"
        face="laser"
      />
    </span>
  );
}
