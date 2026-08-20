/**
 * The box you start a run from — the `ai` window's composer, in the agent window.
 *
 * Deliberately the same component and the same gesture: type, press send, and a
 * conversation begins. The two windows are one object seen from two ends — a run
 * being written and a run being read — so the thing you type into should not
 * look like a different application depending on which end you are at.
 *
 * With a repository selected, this is `Ask Hex` pointed at a repository instead
 * of at an event: the subject sits above the box, and the message goes out with
 * an `a` tag naming it. Nothing is written into what the operator typed — the
 * agent resolves the pointer and grounds itself, the way it would from an
 * event, so the transcript attributes to them only the words they wrote.
 */

import { useState } from "react";
import { FolderGit2, X } from "lucide-react";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { UserName } from "@/components/nostr/UserName";
import { useAccount } from "@/hooks/useAccount";
import accountManager from "@/services/accounts";
import { startSession } from "@/services/agent-start";
import type { MyRepository } from "@/hooks/useMyRepositories";

export function StartConversation({
  agent,
  repository,
  onClearRepository,
  onStarted,
}: {
  agent: string;
  repository?: MyRepository;
  onClearRepository?: () => void;
  /** Called with the message id once a run has actually been accepted. */
  onStarted?: (id: string) => void;
}) {
  const { pubkey } = useAccount();
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async (text: string) => {
    const signer = accountManager.active?.signer;
    if (!pubkey || !signer || !text.trim()) return;
    setSending(true);
    setFailed(null);
    try {
      const { id } = await startSession({
        viewer: pubkey,
        signer,
        agent,
        prompt: text,
        // What the run is about, as a pointer. The agent resolves it and
        // grounds itself in what it names; nothing is written into the
        // operator's own words.
        subjects: repository ? [["a", repository.address]] : [],
      });
      setPrompt("");
      onStarted?.(id);
    } catch (error) {
      // Said, not swallowed: a run nobody received looks exactly like a run
      // that is thinking, until someone waits ten minutes.
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  if (!pubkey)
    return (
      <p className="text-xs text-muted-foreground">Sign in to start a run.</p>
    );

  return (
    <div className="flex flex-col gap-1.5">
      {repository && (
        <div className="flex items-center gap-1.5 rounded border border-dotted border-border px-2 py-1 text-xs">
          <FolderGit2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{repository.name}</span>
          {repository.clone && (
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {repository.clone}
            </span>
          )}
          {onClearRepository && (
            <button
              type="button"
              onClick={onClearRepository}
              className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              title="Start without a repository"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <PromptInput
        onSubmit={(message: PromptInputMessage, event) => {
          event.preventDefault();
          void send(message.text);
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="w-full text-left"
            placeholder={
              repository
                ? `Ask about ${repository.name}…`
                : "Ask this agent to do something…"
            }
            disabled={sending}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <span className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
              to <UserName pubkey={agent} />
            </span>
          </PromptInputTools>
          <PromptInputSubmit
            disabled={!prompt.trim() || sending}
            status={sending ? "submitted" : undefined}
          />
        </PromptInputFooter>
      </PromptInput>

      {failed && <p className="text-xs text-destructive">{failed}</p>}
    </div>
  );
}
