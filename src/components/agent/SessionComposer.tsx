/**
 * Talking to a session, from the transcript that reports it.
 *
 * A running agent is not a recording. It can be redirected mid-thought, stopped,
 * or told to forget — and watching one go wrong with no way to intervene is the
 * worst state a reader can be in. So the transcript gets a composer, in the place
 * every other conversation in this app puts one: the bottom.
 *
 * Stop stays on the surface and the rest fold into a menu. They are the same
 * gesture — an instruction to a run in progress — but not the same weight:
 * stopping is what someone reaches for while watching a run go wrong, and it has
 * to be one click away, whereas compact and clear discard context no relay holds
 * a copy of. Those two ask twice, because the agent's memory of the conversation
 * is the one thing here that a republish cannot restore.
 */

import { useState } from "react";
import { Eraser, MoreHorizontal, Scissors, SquareIcon } from "lucide-react";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

            {/*
              Behind a menu, and behind a second click after that. Both throw
              away context that exists nowhere else — no relay holds the agent's
              working memory — so a mis-click here is the one action in this
              window that cannot be undone by republishing anything.
            */}
            <DropdownMenu
              onOpenChange={(open) => {
                if (!open) setConfirming(null);
              }}
            >
              <DropdownMenuTrigger asChild>
                <PromptInputButton
                  disabled={over || busy !== null}
                  title="Do something to this session's context"
                >
                  <MoreHorizontal className="size-3.5" />
                </PromptInputButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                {(
                  [
                    {
                      command: "compact",
                      icon: Scissors,
                      label: "Compact the context",
                      hint: "Summarise the conversation so far to free room",
                    },
                    {
                      command: "clear",
                      icon: Eraser,
                      label: "Clear the context",
                      hint: "Forget the conversation so far, entirely",
                    },
                  ] as const
                ).map(({ command, icon: Icon, label, hint }) => (
                  <DropdownMenuItem
                    key={command}
                    className={
                      confirming === command
                        ? "text-destructive focus:text-destructive"
                        : undefined
                    }
                    disabled={busy !== null}
                    // Kept open on the first click, so the confirmation is a
                    // second decision rather than a menu that closed and
                    // reopened saying something different.
                    onSelect={(event) => {
                      if (confirming !== command) {
                        event.preventDefault();
                        setConfirming(command);
                        return;
                      }
                      void send(command);
                    }}
                  >
                    <Icon className="size-3.5" />
                    <span className="flex flex-col">
                      <span>
                        {confirming === command ? `${label} — sure?` : label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {hint}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
