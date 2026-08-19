/**
 * Starting a run on one of YOUR repositories.
 *
 * The list is your own kind-30617 announcements, not the agent's checkouts: the
 * question is "which of my projects should something work on", and the agent's
 * sandbox holds whatever its operator put there, which is a different question
 * and usually a different answer.
 *
 * What travels is the CLONE URL, which is the one identifier that works either
 * way — an agent already holding the checkout recognises it, and an agent
 * without one can fetch it. Shown verbatim below the box, because a preamble
 * this client wrote is text the reader did not, and they are the one it will be
 * attributed to.
 *
 * Starting needs no new protocol: an agent opens a session for a message that
 * threads onto nothing and continues one for a reply, which is a rule that
 * already exists and is already load-bearing.
 */

import { useState } from "react";
import { FolderGit2, Send } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserName } from "@/components/nostr/UserName";
import { useAccount } from "@/hooks/useAccount";
import accountManager from "@/services/accounts";
import { scopedPrompt, startSession } from "@/services/agent-start";
import type { MyRepository } from "@/hooks/useMyRepositories";

export function StartRunDialog({
  agent,
  repository,
  open,
  onOpenChange,
}: {
  agent: string;
  repository?: MyRepository;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { pubkey } = useAccount();
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async () => {
    const signer = accountManager.active?.signer;
    if (!pubkey || !signer || !prompt.trim()) return;
    setSending(true);
    setFailed(null);
    try {
      await startSession({ viewer: pubkey, signer, agent, prompt, repository });
      setPrompt("");
      onOpenChange(false);
    } catch (error) {
      // Said, not swallowed: a run nobody received looks exactly like a run
      // that is thinking, until someone waits ten minutes.
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {repository ? (
              <>
                <FolderGit2 className="size-4 shrink-0" />
                Start a run on {repository.name}
              </>
            ) : (
              "Start a run"
            )}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-1 text-xs">
              <span className="flex items-center gap-1">
                with <UserName pubkey={agent} />
              </span>
              {repository?.clone && (
                /* The clone URL, shown because it is what the message will
                   actually say — and the only thing that tells an agent with
                   no copy of this repository where to get one. */
                <span className="font-mono break-all opacity-80">
                  {repository.clone}
                </span>
              )}
              {repository?.description && (
                <span className="opacity-80">{repository.description}</span>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <Textarea
          autoFocus
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What should it do?"
          className="min-h-28 text-sm"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
              void send();
          }}
        />

        {/* Exactly what goes out, because a preamble this client wrote is text
            the reader did not — and they are the one it will be attributed to. */}
        {repository && prompt.trim() && (
          <pre className="max-h-24 overflow-y-auto rounded bg-muted/50 p-2 text-[11px] whitespace-pre-wrap text-muted-foreground">
            {scopedPrompt(prompt.trim(), repository)}
          </pre>
        )}

        {failed && <p className="text-xs text-destructive">{failed}</p>}

        <DialogFooter>
          <Button
            size="sm"
            disabled={!prompt.trim() || sending || !pubkey}
            onClick={() => void send()}
          >
            <Send className="size-3.5" />
            {sending ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
