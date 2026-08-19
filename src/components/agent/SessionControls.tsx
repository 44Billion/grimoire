/**
 * Driving a session from the transcript that reports it.
 *
 * A running agent is not a video: it can be redirected, stopped, or told to
 * forget. Those are the runtime's own primitives, and every one of them exists
 * because watching a run go wrong with no way to intervene is the worst state a
 * reader can be in.
 *
 * They are grouped by how much they destroy. Steering and stopping are ordinary
 * — a turn cancelled is a turn you did not want. Compact and clear discard
 * context that no relay holds a copy of, so they sit behind a confirmation: the
 * agent's memory of the conversation is the one thing here that a republish
 * cannot restore.
 */

import { useState } from "react";
import { Eraser, Scissors, Square } from "lucide-react";

import { useAccount } from "@/hooks/useAccount";
import accountManager from "@/services/accounts";
import { sendSessionControl } from "@/services/agent-control";
import type { SessionCommand } from "@/services/agent-control";
import { Button } from "@/components/ui/button";
import { TERMINAL_STATUSES } from "@/lib/agent-session/types";

export function SessionControls({
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
  const [steer, setSteer] = useState("");
  const [confirming, setConfirming] = useState<SessionCommand | null>(null);

  // A run that ended takes no instructions. Offering them would be a row of
  // buttons that quietly do nothing.
  const over = (TERMINAL_STATUSES as readonly string[]).includes(status);
  if (!pubkey || over) return null;

  const send = async (command: SessionCommand, text?: string) => {
    const signer = accountManager.active?.signer;
    if (!signer) return;
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
      if (command === "steer") setSteer("");
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (steer.trim()) void send("steer", steer.trim());
        }}
      >
        <input
          value={steer}
          onChange={(event) => setSteer(event.target.value)}
          placeholder="Say something to this session"
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
        />
        <Button size="sm" type="submit" disabled={busy !== null}>
          Send
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || status !== "active"}
          onClick={() => void send("cancel")}
          title="Stop whatever is running now"
        >
          <Square className="h-3 w-3" />
          Stop
        </Button>

        {/* Both of these throw away context nobody else holds a copy of. */}
        {(["compact", "clear"] as const).map((command) => (
          <Button
            key={command}
            size="sm"
            variant={confirming === command ? "destructive" : "ghost"}
            disabled={busy !== null}
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
              <Scissors className="h-3 w-3" />
            ) : (
              <Eraser className="h-3 w-3" />
            )}
            {confirming === command ? "Sure?" : command}
          </Button>
        ))}
      </div>

      {failed && <p className="text-xs text-destructive">{failed}</p>}
    </div>
  );
}
