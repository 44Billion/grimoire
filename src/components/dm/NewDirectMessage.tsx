/**
 * Starting a conversation with someone.
 *
 * Takes an npub or an nprofile and nothing else — the same thing the `chat`
 * command claims, and for the same reason: a bare hex string is as plausibly an
 * event id, and opening a private conversation with a stranger because someone
 * pasted the wrong thing is the wrong failure.
 *
 * Nothing is sent here. Resolving a recipient only opens the pane; the first
 * message is what reaches a relay, and that is where the "this person has
 * nowhere to receive mail" error belongs.
 */

import { useState } from "react";
import { resolveRecipient } from "@/lib/dm/recipient";
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

export function NewDirectMessage({
  open,
  onOpenChange,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: (peer: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();

  const submit = () => {
    const peer = resolveRecipient(value);
    if (!peer) {
      setError("That is not an npub or an nprofile.");
      return;
    }
    setValue("");
    setError(undefined);
    onOpenChange(false);
    onResolved(peer);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Messages are gift-wrapped: the relay that holds one cannot tell who
            sent it.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          placeholder="npub1… or nprofile1…"
          onChange={(e) => {
            setValue(e.target.value);
            setError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={!value.trim()}>
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
