import db from "@/services/db";
import { queryProfile } from "nostr-tools/nip05";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";

export function useNip05(nip05: string) {
  const resolved = useLiveQuery(() => db.nip05.get(nip05), [nip05]);
  useEffect(() => {
    if (resolved) return;
    queryProfile(nip05).then((result) => {
      if (result) {
        db.nip05.put({
          nip05,
          pubkey: result.pubkey,
        });
      }
    });
  }, [resolved, nip05]);
  return resolved?.pubkey;
}
