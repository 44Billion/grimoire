import { ListPlus, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/hooks/useAccount";
import { useListMembership } from "@/hooks/useFavoriteList";
import { useRelayListMembership } from "@/hooks/useRelayListMembership";
import { useGrimoire } from "@/core/state";
import { RELAY_MEMBERSHIP_LISTS } from "@/config/favorite-lists";
import { relayTagStrategy } from "@/lib/favorite-tag-strategies";
import { warnIfBlockingOwnInfrastructure } from "@/lib/relay-block-warning";
import type { RelayMode } from "@/lib/relay-list-utils";

const BLOCKED_RELAYS_KIND = 10006;

const NIP65_MODES: { value: RelayMode | "none"; label: string }[] = [
  { value: "readwrite", label: "Read + write" },
  { value: "read", label: "Read only" },
  { value: "write", label: "Write only" },
  { value: "none", label: "Not in list" },
];

/** One checkbox row bound to a NIP-51 relay list. */
function RelayListToggle({
  kind,
  label,
  url,
}: {
  kind: number;
  label: string;
  url: string;
}) {
  const list = useListMembership(kind, relayTagStrategy);
  const { state } = useGrimoire();
  const checked = list.has(url);

  const onToggle = () => {
    if (kind === BLOCKED_RELAYS_KIND && !checked) {
      warnIfBlockingOwnInfrastructure([url], state.nwcConnection?.relays ?? []);
    }
    void list.toggle(url);
  };

  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      disabled={!list.canWrite || list.isUpdating}
      onSelect={(e) => e.preventDefault()}
      onCheckedChange={onToggle}
      title={list.canWrite ? undefined : "List not loaded yet"}
    >
      {label}
      {list.isUpdating && <Loader2 className="ml-auto size-3 animate-spin" />}
    </DropdownMenuCheckboxItem>
  );
}

/**
 * "Add to list" control for a relay: NIP-65 read/write mode plus the NIP-51
 * relay lists. Hidden for read-only accounts.
 */
export function RelayListsMenu({ url }: { url: string }) {
  const { canSign } = useAccount();
  const nip65 = useRelayListMembership();

  if (!canSign) return null;

  const mode = nip65.mode(url) ?? "none";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Add relay to lists">
          <ListPlus className="size-4" />
          Lists
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Relay list (NIP-65)</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(v) =>
            void nip65.setMode(url, v === "none" ? null : (v as RelayMode))
          }
        >
          {NIP65_MODES.map((m) => (
            <DropdownMenuRadioItem
              key={m.value}
              value={m.value}
              disabled={!nip65.canWrite || nip65.isUpdating}
              onSelect={(e) => e.preventDefault()}
              title={nip65.canWrite ? undefined : "Relay list not loaded yet"}
            >
              {m.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Other lists</DropdownMenuLabel>
        {RELAY_MEMBERSHIP_LISTS.map(({ kind, label }) => (
          <RelayListToggle key={kind} kind={kind} label={label} url={url} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
