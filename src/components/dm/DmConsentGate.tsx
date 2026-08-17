/**
 * The one thing standing between an account and its own inbox.
 *
 * Opening a gift wrap costs two `nip44.decrypt` calls. Against a browser
 * extension or a remote bunker that is two prompts or two round trips PER
 * MESSAGE, so a backlog of two hundred is four hundred of them, unannounced,
 * the moment a pane mounts. Asking once is the difference between a feature and
 * an ambush.
 *
 * Asked once per account and never again: everything opened is mirrored
 * locally, so the cost is paid a single time and a second prompt would be the
 * same annoyance wearing a different hat.
 *
 * Rendered by both the DM pane in ChatViewer and the Concord sidebar, which is
 * why it is a component and not an inline branch in either. `compact` is the
 * sidebar's shape: the same words, left-aligned, sized for a column rather
 * than for a pane.
 */

import { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DirectMessagesStatus } from "@/hooks/useDirectMessages";

export function DmConsentGate({
  status,
  onGrant,
  compact,
}: {
  status: DirectMessagesStatus;
  onGrant: () => Promise<void>;
  compact?: boolean;
}) {
  const [working, setWorking] = useState(false);

  if (status === "loading") return null;

  if (status === "readonly")
    return (
      <Shell compact={compact}>
        Sign in with a signer to read private messages — they are encrypted to
        your key, and a read-only account holds none.
      </Shell>
    );

  if (status === "no-nip44")
    return (
      <Shell compact={compact}>
        This signer cannot do NIP-44, so private messages are unreadable to it.
        Sign in with one that can.
      </Shell>
    );

  if (status !== "needs-consent") return null;

  return (
    <Shell compact={compact}>
      <Lock className={compact ? "mb-1 size-3" : "mx-auto mb-2 size-4"} />
      <p className={compact ? "mb-2" : "mb-3"}>
        Your private messages are stored encrypted, one envelope each. Opening
        them asks your signer to decrypt every one — after that they are kept
        locally and never decrypted again.
      </p>
      <Button
        size="sm"
        disabled={working}
        onClick={() => {
          setWorking(true);
          void onGrant().finally(() => setWorking(false));
        }}
      >
        {working && <Loader2 className="mr-1.5 size-3 animate-spin" />}
        Load private messages
      </Button>
    </Shell>
  );
}

function Shell({
  compact,
  children,
}: {
  compact?: boolean;
  children: React.ReactNode;
}) {
  if (compact)
    return (
      <div className="px-2 py-1 text-xs text-muted-foreground">{children}</div>
    );
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <div className="max-w-sm">{children}</div>
    </div>
  );
}
