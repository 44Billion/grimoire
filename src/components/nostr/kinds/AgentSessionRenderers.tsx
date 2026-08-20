import { useMemo } from "react";
import { Bot, Hash, MessageSquare, Users } from "lucide-react";

import type { NostrEvent } from "@/types/nostr";
import { parseAgentEvent } from "@/lib/agent-session/decode";
import type { DecodedDefinition, DecodedHead } from "@/lib/agent-session/types";
import { Label } from "@/components/ui/label";
import { SessionTitle } from "@/components/agent/SessionTitle";
import { NIPBadge } from "@/components/NIPBadge";
import { StatusBadge } from "@/components/agent/status";
import { StatStrip, summariseHeads } from "@/components/agent/Stats";
import { UserName } from "@/components/nostr/UserName";
import { RelayLink } from "@/components/nostr/RelayLink";
import { BaseEventContainer } from "./BaseEventRenderer";

/**
 * One number, named. The point of the row is to be readable at a glance, so the
 * figure is the loud part and the word under it is the quiet part.
 */

export function AgentSessionHeadBody({
  head,
  /**
   * The session's own definition, for the one number the head cannot carry.
   *
   * How full the context is needs a ceiling, and the ceiling belongs to the
   * model rather than to the run — so it is published once on the definition
   * instead of on a head that is rewritten dozens of times a session.
   */
  definition,
  /**
   * Drop the title row, for a caller that already renders one.
   *
   * The session viewer puts the title and status in its pane heading, where
   * they survive scrolling. Repeating them a line below is the reader seeing
   * the same sentence twice and wondering which one is authoritative.
   */
  titled = true,
}: {
  head: DecodedHead;
  definition?: DecodedDefinition;
  titled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {titled && (
          <>
            <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">
              <SessionTitle title={head.title} />
            </span>
            <StatusBadge status={head.status} />
          </>
        )}
        {/*
          Where it ran, beside what it is. A transcript is read away from the
          conversation that produced it, so this is the only answer to "where
          did this happen" — and the protocol is what decides whether the room
          is something this client could even open.
        */}
        {head.channel && (
          // The protocol as the NIP it IS, clickable through to the spec like
          // every other NIP reference in the app — rather than a badge that
          // spells a NIP number and does nothing when pressed.
          <span className="ml-auto shrink-0" title={channelTitle(head.channel)}>
            <NIPBadge nipNumber={nipOf(head.channel.transport)} size="sm" />
          </span>
        )}
      </div>
      {/*
        Where it happened, but only where that is news.
        
        In the session view the pane heading already names the run and the
        transport tag already says how it was asked for — and for a private
        channel the "room" IS the person, who is named again on the very next
        line as the author of the first turn. Three sayings of one fact, and the
        first one looked like a message from them.
      */}
      {titled && head.channel?.id && <ChannelLine channel={head.channel} />}
      {/*
        The same four numbers the dashboard shows, scoped to this run — one
        component, so a session's header and the strip above it cannot drift
        into disagreeing about what "tokens" means. `runs` becomes `turns`,
        which is the same question asked of one conversation.
      */}
      {/*
        No count on a session. It used to say "turns" and count published
        EVENTS — one question with a tool call is four of them — so a
        two-message run reported four and nobody could tell what it meant.
      */}
      <StatStrip
        stats={{ ...summariseHeads([head]), count: head.turns ?? 0 }}
        context={
          definition?.model?.contextWindow
            ? {
                /*
                 * What is IN the window right now, which is the input of the
                 * latest turn — not the sum of every turn ever run. A session
                 * that has spent two million tokens against a 200k window has
                 * not overflowed it; it has been fed the same prefix eighty
                 * times, which is what the cache figure beside it measures.
                 */
                usedTokens: head.usage?.input ?? 0,
                maxTokens: definition.model.contextWindow,
                modelId: definition.model.id,
              }
            : undefined
        }
      />
    </div>
  );
}

/**
 * The room, rendered as whatever the room actually is.
 *
 * A NIP-17 channel identifier IS a pubkey, so it gets a name and a face rather
 * than 64 hex characters; a NIP-29 one is `<relay-host>'<group-id>`, and the
 * host half is a relay this app already knows how to render. Anything else is
 * printed verbatim, which is the honest thing to do with an identifier written
 * by a protocol this build has never heard of.
 */
function ChannelLine({
  channel,
}: {
  channel: { transport: string; id?: string };
}) {
  const id = channel.id;
  if (!id) return null;

  /**
   * A pubkey is a person, whichever envelope carried the request.
   *
   * `nip-17` names the person on the other end of the conversation; `nip-59`
   * names the operator who asked for the run over the control plane, where
   * there is no conversation at all. Both are 64 hex characters, which is the
   * one representation that tells a reader nothing.
   */
  if (/^[0-9a-f]{64}$/i.test(id))
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <MessageSquare className="h-3 w-3 shrink-0" />
        <UserName pubkey={id} />
      </div>
    );

  const [host, group] = id.includes("'") ? id.split("'", 2) : [undefined, id];
  if (channel.transport === "nip-29" && host)
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Users className="h-3 w-3 shrink-0" />
        <RelayLink url={`wss://${host}`} />
        <span className="font-mono">{group}</span>
      </div>
    );

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Hash className="h-3 w-3 shrink-0" />
      <span className="truncate font-mono">{id}</span>
    </div>
  );
}

/**
 * The NIP a transport is.
 *
 * `nip-17` is NIP-17 — the name already carries the number, so this reads it
 * rather than keeping a second table that can disagree with the first.
 */
function nipOf(transport: string): string {
  const digits = /nip-?(\d+)/i.exec(transport)?.[1];
  return digits ? digits.padStart(2, "0") : transport;
}

/** The tooltip on the transport tag: the protocol, and the room under it. */
function channelTitle(channel: { transport: string; id?: string }): string {
  return channel.id
    ? `${channel.transport} — ${channel.id}`
    : channel.transport;
}

export function AgentSessionHeadRenderer({ event }: { event: NostrEvent }) {
  const head = useMemo(() => {
    const decoded = parseAgentEvent(event as never);
    return decoded?.type === "head" ? decoded : null;
  }, [event]);

  return (
    <BaseEventContainer event={event}>
      {head ? (
        <AgentSessionHeadBody head={head} />
      ) : (
        <p className="text-sm text-muted-foreground">
          An agent published a run here, in a shape this version of grimoire
          does not understand yet.
        </p>
      )}
    </BaseEventContainer>
  );
}

export function AgentDefinitionBody({
  definition,
  onTry,
}: {
  definition: DecodedDefinition;
  onTry?: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {definition.picture ? (
          <img
            src={definition.picture}
            alt=""
            className="h-8 w-8 rounded border border-border object-cover"
          />
        ) : (
          <Bot className="h-5 w-5 text-muted-foreground" />
        )}
        <span className="font-medium">{definition.name}</span>
        <Label size="sm">{definition.slug}</Label>
      </div>
      {definition.about && <p className="text-sm">{definition.about}</p>}
      {definition.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {definition.tools.map((tool) => (
            <Label
              key={tool.name}
              size="sm"
              title={tool.description ?? tool.name}
            >
              {tool.name}
            </Label>
          ))}
        </div>
      )}
      {definition.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {definition.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onTry?.(suggestion)}
              className="rounded border border-dotted border-border px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentDefinitionRenderer({ event }: { event: NostrEvent }) {
  const definition = useMemo(() => {
    const decoded = parseAgentEvent(event as never);
    return decoded?.type === "definition" ? decoded : null;
  }, [event]);

  return (
    <BaseEventContainer event={event}>
      {definition ? (
        <AgentDefinitionBody definition={definition} />
      ) : (
        <p className="text-sm text-muted-foreground">
          An agent described itself here, in a shape this version of grimoire
          does not understand yet.
        </p>
      )}
    </BaseEventContainer>
  );
}
