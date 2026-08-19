/**
 * The turn being written, under the ones that finished.
 *
 * Everything here is provisional and says so: a caret, a muted tone, and no
 * metadata — a turn in flight has no `stop`, no usage and no cost, because it has
 * not ended. When the stored turn arrives this disappears and the real one takes
 * its place, which is why it must look like a preview and not like history.
 *
 * A dropped fragment is stated rather than hidden. Text with an invisible hole in
 * it is the one outcome worse than no text.
 */

import { Bot, Brain, Wrench } from "lucide-react";

import { Markdown } from "@/components/Markdown";
import { UserName } from "@/components/nostr/UserName";
import type { LiveTurn as LiveTurnState } from "@/hooks/useAgentDeltas";
import { cn } from "@/lib/utils";

export function LiveTurnBody({
  live,
  agent,
}: {
  live: LiveTurnState;
  agent: string;
}) {
  if (live.turn === 0 || live.parts.length === 0) return null;

  const reasoning = live.parts
    .filter((part) => part.delta === "reasoning")
    .map((part) => part.text)
    .join("");
  const text = live.parts
    .filter((part) => part.delta === "text")
    .map((part) => part.text)
    .join("");
  const tools = live.parts.filter((part) => part.delta === "tool");

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex items-center gap-1.5 text-sm">
        <UserName pubkey={agent} />
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
        {/* The dot the rest of the app uses for a thing that is happening now. */}
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        <span className="text-[11px] text-success">working</span>
      </div>

      <div className="flex w-full flex-col gap-2 opacity-80">
        {reasoning && (
          <p className="flex gap-1.5 border-l-2 border-border pl-2 text-xs whitespace-pre-wrap text-muted-foreground">
            <Brain className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{reasoning}</span>
          </p>
        )}

        {tools.map((part) => (
          <p
            key={`${part.part}-${part.toolId ?? ""}`}
            className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground"
          >
            <Wrench className="h-3 w-3 shrink-0" />
            <span className="truncate">{part.text}</span>
          </p>
        ))}

        {text && (
          <div className="relative">
            <Markdown>{text}</Markdown>
            {/* A caret, because a preview that looks finished reads as an answer. */}
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-text-bottom" />
          </div>
        )}
      </div>

      {live.incomplete && (
        <p className={cn("text-[10px] text-warning")}>
          part of this preview did not arrive — the turn itself will carry all
          of it
        </p>
      )}
    </div>
  );
}
