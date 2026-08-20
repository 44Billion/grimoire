/**
 * The box you start a run from — the `ai` window's composer, in the agent window.
 *
 * Deliberately the same component and the same gesture: type, press send, and a
 * conversation begins. The two windows are one object seen from two ends — a run
 * being written and a run being read — so the thing you type into should not
 * look like a different application depending on which end you are at.
 *
 * With a repository selected, this is `Ask Hex` pointed at a repository instead
 * of at an event: the subject sits above the box, the message goes out scoped to
 * it, and what will actually be sent is shown before it is.
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
import { scopedPrompt, startSession } from "@/services/agent-start";
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
        repository,
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

      {/* Exactly what goes out. A preamble this client wrote is text the reader
          did not, and they are the one the whole message gets attributed to. */}
      {repository && prompt.trim() && (
        <pre className="max-h-24 overflow-y-auto rounded bg-muted/50 p-2 text-[11px] whitespace-pre-wrap text-muted-foreground">
          {scopedPrompt(prompt.trim(), repository)}
        </pre>
      )}

      {failed && <p className="text-xs text-destructive">{failed}</p>}
    </div>
  );
}
