import { useMemo } from "react";
import { Bot, Hash, MessageSquare, Users } from "lucide-react";

import type { NostrEvent } from "@/types/nostr";
import { parseAgentEvent } from "@/lib/agent-session/decode";
import type { DecodedDefinition, DecodedHead } from "@/lib/agent-session/types";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/agent/status";
import { UserName } from "@/components/nostr/UserName";
import { RelayLink } from "@/components/nostr/RelayLink";
import { cacheRate } from "@/lib/agent-session/usage";
import { useLocale } from "@/hooks/useLocale";
import { BaseEventContainer } from "./BaseEventRenderer";

/**
 * One number, named. The point of the row is to be readable at a glance, so the
 * figure is the loud part and the word under it is the quiet part.
 */
function Stat({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="font-mono text-sm text-foreground">{value}</span>
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  );
}

/** Thousands separators from the reader's locale, never a hardcoded one. */
function useCompactNumber() {
  const { locale } = useLocale();
  return (value: number) => new Intl.NumberFormat(locale).format(value);
}

export function AgentSessionHeadBody({ head }: { head: DecodedHead }) {
  const format = useCompactNumber();
  const usage = head.usage;

  // The number that explains a cheap long session. Shared, because the wrong
  // version of it is easy to write and was written.
  const rate = cacheRate(usage);
  const cachePercent = rate === undefined ? undefined : Math.round(rate * 100);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">
          {head.title || "untitled session"}
        </span>
        <StatusBadge status={head.status} />
        {/*
          Where it ran, beside what it is. A transcript is read away from the
          conversation that produced it, so this is the only answer to "where
          did this happen" — and the protocol is what decides whether the room
          is something this client could even open.
        */}
        {head.channel && (
          <Label
            size="sm"
            className="ml-auto shrink-0"
            title={channelTitle(head.channel)}
          >
            {head.channel.transport}
          </Label>
        )}
      </div>
      {head.channel?.id && <ChannelLine channel={head.channel} />}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        {usage && (
          <>
            <Stat label="in" value={format(usage.input)} />
            <Stat label="out" value={format(usage.output)} />
            {usage.cacheRead > 0 && (
              <Stat
                label="cached"
                value={format(usage.cacheRead)}
                title="Input tokens served from the provider's cache"
              />
            )}
            {cachePercent !== undefined && (
              <Stat
                label="cache rate"
                value={`${cachePercent}%`}
                title={`${format(usage.cacheRead)} of ${format(usage.input)} input tokens came from cache`}
              />
            )}
          </>
        )}
        {head.cost && (
          <Stat
            label={head.cost.currency}
            value={head.cost.amount}
            title="What this session cost the operator"
          />
        )}
      </div>
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

  if (channel.transport === "nip-17" && /^[0-9a-f]{64}$/i.test(id))
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
          A session head this client could not read.
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
          An agent definition this client could not read.
        </p>
      )}
    </BaseEventContainer>
  );
}
