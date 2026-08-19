/**
 * The question a run stopped to ask, and the answer going back.
 *
 * This is the one place the transcript stops being a record and becomes a
 * control surface. A session that asked something and got no reply is not idle
 * and not broken — it is waiting, indefinitely and durably, and the only thing
 * standing between it and finishing is a person who may not know they were asked.
 *
 * Answering publishes a `1779` addressed to the agent. Not a chat reply: the
 * runtime resolves a request by id and refuses to guess which of several open
 * questions a bare message meant, so the id has to travel with the answer.
 *
 * `settled` renders the same question with its answer, because a transcript read
 * afterwards should show what was asked and what was said, not a live prompt for
 * a decision made an hour ago.
 */

import { useState } from "react";
import { CircleHelp, ShieldQuestion } from "lucide-react";

import { useAccount } from "@/hooks/useAccount";
import accountManager from "@/services/accounts";
import { sendSessionControl } from "@/services/agent-control";
import type { InputRequestPart } from "@/lib/agent-session/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function InputRequestRow({
  part,
  agent,
  session,
  /** Answered already: show what was asked, not a live prompt. */
  settled,
}: {
  part: InputRequestPart;
  agent: string;
  session: string;
  settled?: boolean;
}) {
  const { pubkey } = useAccount();
  const [sending, setSending] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [failed, setFailed] = useState<string | null>(null);

  const approval = part.requestKind === "tool-approval";
  const Icon = approval ? ShieldQuestion : CircleHelp;

  const answer = async (option?: string, text?: string) => {
    const signer = accountManager.active?.signer;
    if (!pubkey || !signer) return;
    setSending(option ?? "text");
    setFailed(null);
    try {
      await sendSessionControl({
        viewer: pubkey,
        signer,
        agent,
        session,
        command: "respond",
        request: part.requestId,
        option,
        text,
      });
    } catch (error) {
      // Said, not swallowed: an answer that silently failed leaves someone
      // waiting on an agent that is waiting on them.
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(null);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded border p-2",
        settled ? "border-border" : "border-warning/60 bg-warning/5",
      )}
    >
      <p className="flex items-start gap-1.5 text-sm">
        <Icon
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0",
            settled ? "text-muted-foreground" : "text-warning",
          )}
        />
        <span>{part.prompt}</span>
      </p>

      {part.tool?.name && (
        <p className="font-mono text-xs text-muted-foreground">
          {part.tool.name}
        </p>
      )}

      {!settled && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(part.options ?? []).map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant={
                  option.style === "danger"
                    ? "destructive"
                    : option.style === "primary"
                      ? "default"
                      : "outline"
                }
                disabled={sending !== null}
                title={option.description}
                onClick={() => void answer(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {(part.allowFreeform || !part.options?.length) && (
            <form
              className="flex gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (typed.trim()) void answer(undefined, typed.trim());
              }}
            >
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Your answer"
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
              />
              <Button size="sm" type="submit" disabled={sending !== null}>
                Send
              </Button>
            </form>
          )}
        </>
      )}

      {failed && <p className="text-xs text-destructive">{failed}</p>}
    </div>
  );
}
