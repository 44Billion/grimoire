/**
 * The call in a channel's header (CORD-07 §4).
 *
 * A count, and the roster behind it. Presence is announced over the channel
 * itself, so this is what every member can see without joining anything and
 * without any relay or broker learning who is talking.
 *
 * The roster renders MEMBERS, not SFU participants: an author whose fresh
 * signed presence is the only claim on its identity. A contested identity —
 * a member copying a victim's into their own `joined` — proves nothing about
 * either author, and §4 says both render unverified until the stale claim ages
 * out.
 */

import { Headphones, Hand, ShieldAlert } from "lucide-react";

import { UserName } from "@/components/nostr/UserName";
import { cn } from "@/lib/utils";
import { verifiedAuthorOf, type VoicePresenceFold } from "@/lib/concord/voice";

/**
 * The header control: a headset, and how many are in the call.
 *
 * Always present, because every channel is callable (CORD-07 §1) — there is no
 * voice channel to have been created, so an empty count is an invitation rather
 * than an absence. Clicking opens the call in its own window, which is where the
 * roster, the controls and the tiles live.
 */
export function VoiceHeaderButton({
  count,
  active,
  onOpen,
}: {
  count: number;
  /** Whether the app's one call is this channel's. */
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={
        active
          ? "You are in this call"
          : count === 0
            ? "Start a call in this channel"
            : count === 1
              ? "1 member is in a call — join them"
              : `${count} members are in a call — join them`
      }
      className={cn(
        "flex items-center gap-1 rounded px-1 py-0.5 text-xs tabular-nums leading-none hover:bg-muted",
        active && "bg-muted text-primary",
      )}
    >
      <Headphones className="size-3.5 shrink-0" />
      {count > 0 ? count : null}
    </button>
  );
}

/** Who is in the call, under the header rather than inside the timeline. */
export function VoiceRoster({ fold }: { fold: VoicePresenceFold }) {
  if (fold.present.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/20 px-3 py-1.5 text-xs">
      {fold.present.map((p) => {
        const verified = verifiedAuthorOf(fold, p.identity) === p.author;
        return (
          <span
            key={`${p.author}:${p.identity}`}
            className={cn("flex items-center gap-1", !verified && "opacity-70")}
          >
            <UserName pubkey={p.author} className="text-xs" />
            {p.hand && (
              <Hand
                className="size-3 text-muted-foreground"
                aria-label="hand raised"
              />
            )}
            {/* Two members claiming one SFU identity is the one thing §4
                refuses to guess about, so neither renders as proven. */}
            {!verified && (
              <ShieldAlert
                className="size-3 text-muted-foreground"
                aria-label="unverified"
              />
            )}
          </span>
        );
      })}
    </div>
  );
}
