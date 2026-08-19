/**
 * Talking to a session, from the transcript that reports it.
 *
 * A running agent is not a recording. It can be redirected mid-thought, stopped,
 * or told to forget — and watching one go wrong with no way to intervene is the
 * worst state a reader can be in. So the transcript gets a composer, in the place
 * every other conversation in this app puts one: the bottom.
 *
 * The actions sit beside the text box rather than in a menu somewhere, because
 * they are all the same gesture — an instruction to a run in progress — and only
 * differ in how much they throw away. Compact and clear discard context no relay
 * holds a copy of, so they ask twice; the agent's memory of the conversation is
 * the one thing here a republish cannot restore.
 */

import { useState } from "react";
import { Eraser, Scissors, SquareIcon } from "lucide-react";

import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { useAccount } from "@/hooks/useAccount";
import accountManager from "@/services/accounts";
import { sendSessionControl } from "@/services/agent-control";
import type { SessionCommand } from "@/services/agent-control";
import { TERMINAL_STATUSES } from "@/lib/agent-session/types";

export function SessionComposer({
  agent,
  session,
  status,
}: {
  agent: string;
  session: string;
  status: string;
}) {
  const { pubkey } = useAccount();
  const [busy, setBusy] = useState<SessionCommand | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SessionCommand | null>(null);

  const over = (TERMINAL_STATUSES as readonly string[]).includes(status);

  const send = async (command: SessionCommand, text?: string) => {
    const signer = accountManager.active?.signer;
    if (!pubkey || !signer) return;
    setBusy(command);
    setFailed(null);
    try {
      await sendSessionControl({
        viewer: pubkey,
        signer,
        agent,
        session,
        command,
        text,
      });
    } catch (error) {
      // Said, not swallowed: an instruction that silently failed leaves someone
      // believing they stopped something that is still running.
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  if (!pubkey) return null;

  return (
    <div className="border-t border-border bg-background p-2">
      <PromptInput
        onSubmit={(message: PromptInputMessage, event) => {
          event.preventDefault();
          const text = message.text.trim();
          if (text) void send("steer", text);
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            /*
             * `field-sizing-content` sizes the box to its text, so an empty
             * composer shrank to the width of its own placeholder and sat
             * centred in the row. The text was never centred; the element was.
             */
            className="w-full text-left"
            placeholder={
              over
                ? "This session has ended."
                : "Say something to this session…"
            }
            disabled={over || busy !== null}
          />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools>
            {/*
              Stop is offered only while something is actually running. On an idle
              session it would be a button that does nothing, which teaches a
              reader to distrust the rest of them.
            */}
            <PromptInputButton
              disabled={status !== "active" || busy !== null}
              onClick={() => void send("cancel")}
              title="Stop whatever is running now"
            >
              <SquareIcon className="size-3.5" />
              Stop
            </PromptInputButton>

            {(["compact", "clear"] as const).map((command) => (
              <PromptInputButton
                key={command}
                variant={confirming === command ? "destructive" : "ghost"}
                disabled={over || busy !== null}
                onClick={() =>
                  confirming === command
                    ? void send(command)
                    : setConfirming(command)
                }
                title={
                  command === "compact"
                    ? "Summarise the conversation so far to free context"
                    : "Forget the conversation so far"
                }
              >
                {command === "compact" ? (
                  <Scissors className="size-3.5" />
                ) : (
                  <Eraser className="size-3.5" />
                )}
                {confirming === command ? "Sure?" : command}
              </PromptInputButton>
            ))}
          </PromptInputTools>

          <PromptInputSubmit
            disabled={over}
            status={busy === "steer" ? "submitted" : undefined}
          />
        </PromptInputFooter>
      </PromptInput>

      {failed && <p className="pt-1 text-xs text-destructive">{failed}</p>}
    </div>
  );
}
