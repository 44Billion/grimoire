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
 * sidebar's shape: one row among the conversations it is standing in for,
 * rather than a bordered panel with a paragraph in it — nothing has gone
 * wrong, so nothing should look like an alert.
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

  if (status === "loading" || status === "ready") return null;

  // Nothing to offer: these two are facts about the account, not choices, and
  // dressing a fact as a prompt invites a click that cannot help.
  if (status === "readonly" || status === "no-nip44")
    return (
      <Note compact={compact}>
        {status === "readonly"
          ? "Sign in with a signer to read private messages."
          : "This signer cannot decrypt private messages."}
      </Note>
    );

  // In the sidebar this is one row among the conversations it will become —
  // sized and shaped like them, because it is standing in for them. A panel
  // with a border and a paragraph would be an alert, and there is nothing
  // wrong here to alert anyone about.
  if (compact)
    return (
      <button
        type="button"
        disabled={working}
        onClick={() => {
          setWorking(true);
          void onGrant().finally(() => setWorking(false));
        }}
        title="Your messages are stored encrypted. Opening them asks your signer once; after that they are kept locally."
        className="flex w-full cursor-crosshair items-center gap-1.5 px-2 py-0.5 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:cursor-default"
      >
        {working ? (
          <Loader2 className="size-3 flex-shrink-0 animate-spin" />
        ) : (
          <Lock className="size-3 flex-shrink-0" />
        )}
        <span className="truncate">
          {working ? "Opening…" : "Show messages"}
        </span>
      </button>
    );

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-xs flex-col items-center gap-3 text-center">
        <Lock className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Your messages are stored encrypted, one envelope each. Opening them
          asks your signer once — after that they are kept locally and never
          decrypted again.
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
          Show messages
        </Button>
      </div>
    </div>
  );
}

/** A statement, not a prompt: no border, no icon, nothing to press. */
function Note({
  compact,
  children,
}: {
  compact?: boolean;
  children: React.ReactNode;
}) {
  if (compact)
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>
    );
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <p className="max-w-xs">{children}</p>
    </div>
  );
}
