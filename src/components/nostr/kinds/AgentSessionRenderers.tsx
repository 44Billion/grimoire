import { useMemo } from "react";
import { Activity, Bot } from "lucide-react";

import type { NostrEvent } from "@/types/nostr";
import { parseAgentEvent } from "@/lib/agent-session/decode";
import type {
  DecodedDefinition,
  DecodedHead,
  DecodedMilestone,
} from "@/lib/agent-session/types";
import { Label } from "@/components/ui/label";
import { UserName } from "@/components/nostr/UserName";
import { BaseEventContainer } from "./BaseEventRenderer";

/** Terminal statuses read differently from a run still going. */
function StatusLabel({ status }: { status: string }) {
  return <Label size="sm">{status}</Label>;
}

export function AgentSessionHeadBody({ head }: { head: DecodedHead }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">
          {head.title || "untitled session"}
        </span>
        <StatusLabel status={head.status} />
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Label size="sm">{head.turns} turns</Label>
        <Label size="sm">seq ≤ {head.lastSeq}</Label>
        {head.model && <Label size="sm">{head.model.id}</Label>}
        {head.cost && (
          <Label size="sm">
            {head.cost.amount} {head.cost.currency}
          </Label>
        )}
        <span className="flex items-center gap-1">
          for <UserName pubkey={head.operator.pubkey} />
        </span>
      </div>
      {head.streams.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {head.streams.map((stream) => (
            <Label key={`${stream.transport}:${stream.address}`} size="sm">
              {stream.transport} · {stream.visibility} · {stream.redaction}
            </Label>
          ))}
        </div>
      )}
    </div>
  );
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

export function AgentMilestoneBody({
  milestone,
}: {
  milestone: DecodedMilestone;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Activity className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="text-sm">{milestone.text}</span>
      <StatusLabel status={milestone.status} />
      {milestone.step && (
        <Label size="sm">
          step {milestone.step.n}/{milestone.step.total}
        </Label>
      )}
      {milestone.tool && <Label size="sm">{milestone.tool.name}</Label>}
    </div>
  );
}

export function AgentMilestoneRenderer({ event }: { event: NostrEvent }) {
  const milestone = useMemo(() => {
    const decoded = parseAgentEvent(event as never);
    return decoded?.type === "milestone" ? decoded : null;
  }, [event]);

  return (
    <BaseEventContainer event={event}>
      {milestone ? (
        <AgentMilestoneBody milestone={milestone} />
      ) : (
        <p className="text-sm text-muted-foreground">
          A milestone this client could not read.
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
            <Label key={tool.name} size="sm" title={tool.description}>
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
