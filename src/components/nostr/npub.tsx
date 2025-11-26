import { useMemo } from "react";
import { nip19 } from "nostr-tools";

export default function Npub({ pubkey }: { pubkey: string }) {
  const short = useMemo(() => {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 8)}:${npub.slice(-8)}`;
  }, [pubkey]);
  return (
    <span className="text-xs text-muted-foreground overflow-hidden text-ellipsis">
      {short}
    </span>
  );
}
