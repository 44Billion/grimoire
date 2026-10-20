import { Loader2, UserCheck, UserPlus } from "lucide-react";
import { useAccount } from "@/hooks/useAccount";
import { kinds } from "nostr-tools";
import { useListMembership } from "@/hooks/useFavoriteList";
import { pTagStrategy } from "@/lib/favorite-tag-strategies";
import { cn } from "@/lib/utils";

/**
 * Follow / Unfollow toggle for the active account's kind 3 contact list.
 *
 * Renders nothing for a read-only account or for the user's own profile.
 * Disabled until the contact list has loaded, so a click can never publish a
 * list containing only this one pubkey.
 */
export function FollowButton({
  pubkey,
  className,
}: {
  pubkey: string;
  className?: string;
}) {
  const { pubkey: me, canSign } = useAccount();
  const list = useListMembership(kinds.Contacts, pTagStrategy);

  if (!canSign || !me || me === pubkey) return null;

  const following = list.has(pubkey);
  const label = following ? "Unfollow" : "Follow";
  const title = !list.canWrite
    ? "Contact list not loaded yet"
    : following
      ? "Remove from your contact list"
      : "Add to your contact list";

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={following}
      title={title}
      disabled={!list.canWrite || list.isUpdating}
      onClick={() => void list.toggle(pubkey)}
      className={cn(
        "flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        following
          ? "text-foreground hover:text-destructive"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {list.isUpdating ? (
        <Loader2 className="size-3 animate-spin" />
      ) : following ? (
        <UserCheck className="size-3" />
      ) : (
        <UserPlus className="size-3" />
      )}
      <span>{label}</span>
    </button>
  );
}
