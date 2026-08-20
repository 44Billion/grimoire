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
 *
 * `steer` and `cancel` also record an intent (`agent-intents.ts`) the instant
 * they go out. Neither becomes a turn of its own — the transcript would
 * otherwise go quiet about them for exactly as long as the agent takes to
 * react — so the Stop button wears its own intent here, and the steer text
 * (already cleared from this box by the time the promise settles) reappears
 * as a preview in the transcript until the agent's own turn or status change
 * confirms it.
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
import { addIntent, removeIntent } from "@/services/agent-intents";
import { useSessionIntents } from "@/hooks/useSessionIntents";
import { Sending } from "@/components/agent/PendingIntent";
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
  const intents = useSessionIntents(agent, session);
  // A stop already sent, with no status change confirming it yet — see the
  // module docstring for why the button itself is the only place left to
  // show a fact-less "cancel" at all.
  const stopping = intents.some((intent) => intent.command === "cancel");

  const over = (TERMINAL_STATUSES as readonly string[]).includes(status);

  const send = async (command: SessionCommand, text?: string) => {
    const signer = accountManager.active?.signer;
    if (!pubkey || !signer) return;
    setBusy(command);
    setFailed(null);
    // Only `steer` and `cancel` get a preview — see `agent-intents.ts` for why
    // `compact`, `clear` and `reset` have no fact to reconcile against.
    const intentId =
      command === "steer" || command === "cancel"
        ? addIntent(agent, session, { command, text })
        : null;
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
      // Never sent, so nothing to hold onto — leaving it would show a steer
      // that failed as one still in flight.
      if (intentId) removeIntent(agent, session, intentId);
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
              disabled={status !== "active" || busy !== null || stopping}
              onClick={() => void send("cancel")}
              title={
                stopping
                  ? "Already asked this run to stop"
                  : "Stop whatever is running now"
              }
            >
              {stopping ? <Sending /> : <SquareIcon className="size-3.5" />}
              {stopping ? "Stopping…" : "Stop"}
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
