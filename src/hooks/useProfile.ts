import { useEffect } from "react";
import { kinds } from "nostr-tools";
import { profileLoader } from "@/services/loaders";
import { useEventStore, useObservableMemo } from "applesauce-react/hooks";
import { ProfileContent } from "applesauce-core/helpers";
import { ProfileModel } from "applesauce-core/models/profile";

export function useProfile(pubkey: string): ProfileContent | undefined {
  const eventStore = useEventStore();

  const profile = useObservableMemo(
    () => eventStore.model(ProfileModel, pubkey),
    [eventStore, pubkey],
  );

  // Fetch profile if not in store (only runs once per pubkey)
  useEffect(() => {
    if (profile) return; // Already have the event

    const sub = profileLoader({ kind: kinds.Metadata, pubkey }).subscribe({
      next: (fetchedEvent) => {
        if (fetchedEvent) {
          eventStore.add(fetchedEvent);
        }
      },
    });

    return () => sub.unsubscribe();
  }, [pubkey, eventStore]); // Removed event and loading from deps

  return profile;
}
