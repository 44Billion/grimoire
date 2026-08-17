/**
 * The invites offered to this key, and what accepting one does.
 *
 * An invite is a key handoff, so the panel says exactly what is being handed
 * over: which community (proven by its own id, not by the sender's word), who
 * offered it, and which private channels the bundle carries. Nothing here
 * reaches a relay until the reader presses Join.
 */

import { useState, type ReactNode } from "react";
import { Loader2, MailPlus, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

import { Input } from "@/components/ui/input";

import Timestamp from "@/components/Timestamp";
import { UserName } from "@/components/nostr/UserName";
import { Button } from "@/components/ui/button";
import { useConcordImage } from "@/hooks/useConcordImage";
import { formatTimestamp, useLocale } from "@/hooks/useLocale";
import type { ImagePointer } from "@/lib/concord/types";
import type { PendingInvite } from "@/services/concord-invites";

export function ConcordInvitesPanel({
  invites,
  loading,
  error,
  joining,
  joinError,
  onJoin,
  onOpenLink,
  headerPrefix,
  onRefresh,
}: {
  invites: PendingInvite[];
  loading: boolean;
  error?: string;
  /** The invite id currently being accepted, if any. */
  joining?: string;
  joinError?: string;
  onJoin: (invite: PendingInvite) => void;
  onOpenLink: (url: string) => Promise<void>;
  /** The sidebar toggle the chat pane's own header carries. */
  headerPrefix?: ReactNode;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 items-center gap-1 border-b px-1.5">
        {headerPrefix}
        <MailPlus className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm">Invites</span>
        {onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-6"
            title="Check for new invites"
            onClick={onRefresh}
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          </Button>
        )}
      </div>
      {joinError && (
        <div className="border-b px-3 py-1.5 text-xs text-destructive">
          {joinError}
        </div>
      )}
      {error && (
        <div className="border-b px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-3 py-3">
          <LinkBox onOpenLink={onOpenLink} />
          {invites.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {loading
                ? "Reading your invite inbox…"
                : "No invites waiting. A direct invite arrives as a giftwrap addressed to you."}
            </p>
          ) : (
            <div className="mt-2 rounded border">
              {invites.map((invite) => (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  busy={joining === invite.id}
                  // Any join in flight disables every other: two accepts race
                  // to one coordinate, and relays discard the loser — with the
                  // UI reporting both as done.
                  blocked={joining !== undefined}
                  onJoin={onJoin}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Paste a link to open it.
 *
 * The fragment after the `#` is the whole secret and never reaches a server —
 * so a link opened here is fetched from the relays it names and decrypted
 * locally, exactly as it would be in the client that minted it.
 */
function LinkBox({
  onOpenLink,
}: {
  onOpenLink: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const open = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await onOpenLink(url.trim());
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void open();
          }}
          placeholder="Paste an invite link"
          className="h-7 text-xs"
        />
        <Button
          size="sm"
          disabled={busy || !url.trim()}
          onClick={() => void open()}
        >
          {busy && <Loader2 className="size-3 animate-spin" />}
          Open
        </Button>
      </div>
      {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
    </div>
  );
}

function InviteRow({
  invite,
  busy,
  blocked,
  onJoin,
}: {
  invite: PendingInvite;
  busy: boolean;
  blocked: boolean;
  onJoin: (invite: PendingInvite) => void;
}) {
  const { locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const icon = useConcordImage(invite.bundle.icon as ImagePointer | undefined);
  const channels = Array.isArray(invite.bundle.channels)
    ? invite.bundle.channels
    : [];
  const name = invite.bundle.name || invite.bundle.community_id.slice(0, 8);
  // Nothing to act on: the vault already holds everything this bundle carries.
  // It stays listed — an invite you were sent is a fact — but it stops being
  // dressed as something waiting.
  const held = invite.standing === "held";

  return (
    <div
      className={cn("border-b px-3 py-2 last:border-b-0", held && "opacity-60")}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <img
            src={icon}
            alt=""
            className="size-6 shrink-0 rounded-sm object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-dotted text-[10px] text-muted-foreground"
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{name}</div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {invite.sender ? (
              <>
                <span>from</span>
                <UserName pubkey={invite.sender} className="text-xs" />
              </>
            ) : (
              <span>opened from a link</span>
            )}
            <Timestamp timestamp={invite.createdAt} />
          </div>
        </div>
        <Button
          size="sm"
          variant={invite.standing === "new" ? "default" : "outline"}
          disabled={busy || blocked || invite.expired || held}
          onClick={() => onJoin(invite)}
          title={
            invite.expired
              ? "This invite has expired — its preview still renders, but joining refuses."
              : held
                ? "You already hold everything this invite carries."
                : invite.standing === "catch-up"
                  ? "You are in this community, and this bundle carries something you lack — a fresher epoch, or a private channel you were granted since."
                  : "Keep these keys and announce yourself in the community's guestbook."
          }
        >
          {busy && <Loader2 className="size-3 animate-spin" />}
          {invite.expired
            ? "expired"
            : held
              ? "joined"
              : invite.standing === "catch-up"
                ? "Take keys"
                : "Join"}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
      >
        {channels.length === 0
          ? "public channels only"
          : `${channels.length} private channel${channels.length === 1 ? "" : "s"} granted`}
        {invite.bundle.expires_at
          ? ` · expires ${formatTimestamp(Math.floor(invite.bundle.expires_at / 1000), "date", locale)}`
          : ""}
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          {channels.map((ch) => (
            <div key={ch.id} className="truncate">
              # {ch.name || ch.id.slice(0, 8)}
            </div>
          ))}
          <div className="truncate">
            {invite.bundle.relays.length} relay
            {invite.bundle.relays.length === 1 ? "" : "s"} · epoch{" "}
            {invite.bundle.root_epoch}
          </div>
        </div>
      )}
    </div>
  );
}

/** The sidebar row that opens the panel. */
export function InvitesRow({
  count,
  active,
  onClick,
}: {
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-crosshair items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-muted/50 ${
        active ? "bg-muted/70 font-medium" : ""
      }`}
    >
      <MailPlus className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">
        {count === 0
          ? "Invites"
          : count === 1
            ? "1 invite"
            : `${count} invites`}
      </span>
    </button>
  );
}
