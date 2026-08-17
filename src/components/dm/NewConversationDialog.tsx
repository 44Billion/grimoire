/**
 * Choosing who a conversation is with.
 *
 * Three ways in, because people arrive with three different things: a name
 * they half-remember (the local profile index answers as they type), a NIP-05
 * someone read out, or an npub they pasted. All three end at a pubkey, and the
 * chips below the field are the conversation being assembled.
 *
 * More than one recipient makes a group conversation. NIP-17 gets that almost
 * for free — every participant is a `p` tag and the message is wrapped once per
 * person — but it is not free here: a group has no name, no membership event
 * and no way to add someone later without starting a different conversation.
 * Which is why picking the people IS the creation step, and why the button
 * says Create rather than Send.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserName } from "@/components/nostr/UserName";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import type { ProfileSearchResult } from "@/services/profile-search";
import { looksLikeRecipient, resolveRecipientAsync } from "@/lib/dm/recipient";

/** Suggestions shown at once. More is a scroll nobody reads. */
const MAX_SUGGESTIONS = 6;

export function NewConversationDialog({
  open,
  onOpenChange,
  onCreate,
  /** The viewer, so the list does not offer to start a conversation with them. */
  self,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (participants: string[]) => void;
  self?: string;
}) {
  // The form is a CHILD, mounted only while the dialog is open, so closing it
  // resets every field by unmounting. The alternative — an effect that clears
  // the state when `open` goes false — writes state from an effect for no
  // reason, and left a half-assembled conversation alive in a closed dialog.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            Messages are gift-wrapped: the relay that holds one cannot tell who
            sent it. Add more than one person for a group.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <NewConversationForm
            onOpenChange={onOpenChange}
            onCreate={onCreate}
            {...(self ? { self } : {})}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewConversationForm({
  onOpenChange,
  onCreate,
  self,
}: {
  onOpenChange: (open: boolean) => void;
  onCreate: (participants: string[]) => void;
  self?: string;
}) {
  const { searchProfiles } = useProfileSearch();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [matches, setMatches] = useState<ProfileSearchResult[]>([]);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  const chosenSet = useMemo(() => new Set(chosen), [chosen]);

  /**
   * What the field is actually asking for right now.
   *
   * DERIVED rather than cleared: a query too short to search, or one that is
   * plainly an npub, simply has no suggestions — and computing that beats an
   * effect that writes an empty array into state on every keystroke that fails
   * the test.
   */
  const searching =
    query.trim().length >= 2 && !looksLikeRecipient(query.trim());
  const suggestions = searching ? matches : [];

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2 || looksLikeRecipient(value)) return;

    let cancelled = false;
    // The profile index is local, so this is a filter rather than a fetch —
    // no debounce earns its complexity here.
    void searchProfiles(value).then((results) => {
      if (cancelled) return;
      setMatches(
        results
          .filter((r) => r.pubkey !== self && !chosenSet.has(r.pubkey))
          .slice(0, MAX_SUGGESTIONS),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [query, searchProfiles, self, chosenSet]);

  const add = (pubkey: string) => {
    setChosen((prev) => (prev.includes(pubkey) ? prev : [...prev, pubkey]));
    // Clearing the query clears the suggestions with it — they are derived.
    setQuery("");
    setError(undefined);
    inputRef.current?.focus();
  };

  const remove = (pubkey: string) =>
    setChosen((prev) => prev.filter((p) => p !== pubkey));

  /** Enter on a typed npub or NIP-05, rather than on a suggestion. */
  const commitTyped = async () => {
    const value = query.trim();
    if (!value) return;

    // The first suggestion, if the reader was typing a name and pressed Enter
    // rather than clicking. Doing nothing there reads as the dialog ignoring
    // them.
    if (!looksLikeRecipient(value)) {
      if (suggestions[0]) add(suggestions[0].pubkey);
      else setError("No one by that name, and that is not an npub or NIP-05.");
      return;
    }

    setResolving(true);
    try {
      const pubkey = await resolveRecipientAsync(value);
      if (pubkey) add(pubkey);
      else setError(`Could not resolve ${value}.`);
    } finally {
      setResolving(false);
    }
  };

  return (
    <>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chosen.map((pubkey) => (
            <span
              key={pubkey}
              className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
            >
              <UserName pubkey={pubkey} className="pointer-events-none" />
              <button
                type="button"
                onClick={() => remove(pubkey)}
                title="Remove"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
                <span className="sr-only">Remove</span>
              </button>
            </span>
          ))}
        </div>
      )}

      <Input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder="Name, npub1…, nprofile1…, or name@domain"
        onChange={(e) => {
          setQuery(e.target.value);
          setError(undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commitTyped();
          }
          // Backspace on an empty field takes back the last chip — the
          // gesture every recipient field has.
          if (e.key === "Backspace" && !query && chosen.length > 0)
            remove(chosen[chosen.length - 1]);
        }}
      />

      {resolving && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          resolving…
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {suggestions.length > 0 && (
        <div className="flex flex-col rounded border">
          {suggestions.map((result) => (
            <button
              key={result.pubkey}
              type="button"
              onClick={() => add(result.pubkey)}
              className="flex cursor-crosshair items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted/50"
            >
              <span className="truncate">{result.displayName}</span>
              {result.nip05 && (
                <span className="truncate text-xs text-muted-foreground">
                  {result.nip05}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <DialogFooter>
        <Button
          size="sm"
          disabled={chosen.length === 0}
          onClick={() => {
            onOpenChange(false);
            onCreate(chosen);
          }}
        >
          {chosen.length > 1 ? "Create group" : "Create"}
        </Button>
      </DialogFooter>
    </>
  );
}
