/**
 * The question a run stopped to ask, and the answer going back.
 *
 * This is the one place the transcript stops being a record and becomes a
 * control surface. A session that asked something and got no reply is not idle
 * and not broken — it is waiting, durably and indefinitely, and the only thing
 * between it and finishing is a person who may not know they were asked.
 *
 * Answering publishes a `1779` addressed to the agent. Not a chat reply: the
 * runtime resolves a request by id and refuses to guess which of several open
 * questions a bare message meant, so the id has to travel with the answer.
 *
 * `settled` renders the same question with its outcome. A transcript read
 * afterwards should show what was asked and what was decided — a live prompt for
 * a decision made an hour ago is worse than no prompt.
 */

import { useState } from "react";
import { CircleHelp, ShieldQuestion } from "lucide-react";

import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import { useAccount } from "@/hooks/useAccount";
import accountManager from "@/services/accounts";
import { sendSessionControl } from "@/services/agent-control";
import type { InputRequestPart } from "@/lib/agent-session/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function InputRequestRow({
  part,
  agent,
  session,
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
  // Answerable only while it is actually open AND we hold a key to answer with.
  const open = !settled && Boolean(pubkey) && Boolean(session);

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
    <Confirmation
      approval={{ id: part.requestId }}
      state={open ? "approval-requested" : "approval-responded"}
      className={open ? "border-warning/60" : undefined}
    >
      <ConfirmationTitle>
        <span className="flex items-start gap-1.5">
          <Icon
            className={`mt-0.5 size-3.5 shrink-0 ${open ? "text-warning" : "text-muted-foreground"}`}
          />
          <span className="text-foreground">{part.prompt}</span>
        </span>
        {part.tool?.name && (
          <span className="mt-1 block font-mono text-xs text-muted-foreground">
            {part.tool.name}
          </span>
        )}
      </ConfirmationTitle>

      {/*
       * Wrapping, because these options are whatever the run asked — four of
       * them, or one whose label is a sentence — inside a window a person is
       * free to make narrow. A row that cannot wrap pushes the last button out
       * of the pane, and the option you cannot see is the one you cannot pick.
       */}
      <ConfirmationActions className="flex-wrap">
        {(part.options ?? []).map((option) => (
          <ConfirmationAction
            key={option.id}
            className="h-auto max-w-full min-h-8 py-1 text-left whitespace-normal"
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
          </ConfirmationAction>
        ))}
      </ConfirmationActions>

      {/* Free text, when the asker allowed it or offered nothing to pick. */}
      {open && (part.allowFreeform || !part.options?.length) && (
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim()) void answer(undefined, typed.trim());
          }}
        >
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Your answer"
            className="h-8 min-w-0 text-sm"
          />
          <Button size="sm" type="submit" disabled={sending !== null}>
            Send
          </Button>
        </form>
      )}

      {failed && <p className="text-xs text-destructive">{failed}</p>}
    </Confirmation>
  );
}
