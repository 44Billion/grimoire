import { getNIPInfo } from "../lib/nip-icons";
import { useAddWindow } from "@/core/state";
import { isNipDeprecated, isValidNip } from "@/constants/nips";
import { getCommunityNipForNipId } from "@/constants/kinds";

export interface NIPBadgeProps {
  nipNumber: string;
  className?: string;
  showName?: boolean;
  showNIPPrefix?: boolean;
  /**
   * `"sm"` for a badge sitting inline in a line of text, `"md"` (the default)
   * for one in a list or header. A prop rather than a `className` override
   * because padding and font-size are conflicting utilities — which one wins
   * depends on stylesheet order, not on the order they were passed.
   */
  size?: "sm" | "md";
}

const SIZES = {
  sm: "gap-1 px-1 py-0 text-[10px] border-dotted",
  md: "gap-2 px-2.5 py-1.5 text-sm",
} as const;

/**
 * NIPBadge - Reusable component for displaying NIP badges
 * Shows icon, number, optional name, and links to NIP page
 */
export function NIPBadge({
  nipNumber,
  className = "",
  showName = true,
  showNIPPrefix = true,
  size = "md",
}: NIPBadgeProps) {
  const addWindow = useAddWindow();
  const nipInfo = getNIPInfo(nipNumber);
  const name = nipInfo?.name || `NIP-${nipNumber}`;
  const description =
    nipInfo?.description || `Nostr Implementation Possibility ${nipNumber}`;
  const isDeprecated = isNipDeprecated(nipNumber);
  const isExternal = !isValidNip(nipNumber);

  const communityNip = getCommunityNipForNipId(nipNumber);

  const openNIP = () => {
    if (communityNip) {
      const pointer = {
        kind: 30817,
        pubkey: communityNip.pubkey,
        identifier: communityNip.identifier,
        relays: communityNip.relayHints,
      };
      addWindow("open", { pointer }, undefined, communityNip.title);
      return;
    }
    const paddedNum = nipNumber.toString().padStart(2, "0");
    addWindow(
      "nip",
      { number: paddedNum },
      nipInfo ? `NIP ${paddedNum} - ${nipInfo?.name}` : `NIP ${paddedNum}`,
    );
  };

  // External specs (Marmot, AMB, etc.) render as non-interactive labels
  if (isExternal && !communityNip) {
    return (
      <span
        className={`flex items-center border bg-card ${SIZES[size]} ${className}`}
        title={`${nipNumber} (External spec)`}
      >
        <span className="text-muted-foreground">{nipNumber}</span>
      </span>
    );
  }

  return (
    <button
      onClick={openNIP}
      className={`flex items-center border bg-card hover:underline hover:decoration-dotted cursor-crosshair ${SIZES[size]} ${
        isDeprecated ? "opacity-50" : ""
      } ${className}`}
      title={
        isDeprecated
          ? `${description} (DEPRECATED)`
          : communityNip
            ? `${description} (Community NIP)`
            : description
      }
    >
      <span className="text-muted-foreground">
        {`${showNIPPrefix ? "NIP-" : ""}${nipNumber}`}
      </span>
      {showName && nipInfo && (
        <>
          <span>{name}</span>
        </>
      )}
    </button>
  );
}
