import { getKindInfo } from "@/constants/kinds";
import Command from "./Command";
import { ExternalLink } from "lucide-react";
import { kinds } from "nostr-tools";

// NIP-01 Kind ranges
const REPLACEABLE_START = 10000;
const REPLACEABLE_END = 20000;
const EPHEMERAL_START = 20000;
const EPHEMERAL_END = 30000;
const PARAMETERIZED_REPLACEABLE_START = 30000;
const PARAMETERIZED_REPLACEABLE_END = 40000;

export default function KindRenderer({ kind }: { kind: number }) {
  const kindInfo = getKindInfo(kind);
  const Icon = kindInfo?.icon;
  const category = getKindCategory(kind);
  const eventType = getEventType(kind);

  if (!kindInfo) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="text-lg font-semibold mb-2">Kind {kind}</div>
          <p className="text-sm text-muted-foreground">
            This event kind is not yet documented in Grimoire.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        {Icon && (
          <div className="w-14 h-14 bg-accent/20 rounded flex items-center justify-center flex-shrink-0">
            <Icon className="w-8 h-8 text-accent" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold mb-1">{kindInfo.name}</h1>
          <p className="text-muted-foreground">{kindInfo.description}</p>
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="text-muted-foreground">Kind Number</div>
        <code className="font-mono">{kind}</code>

        <div className="text-muted-foreground">Category</div>
        <div>{category}</div>

        <div className="text-muted-foreground">Event Type</div>
        <div>{eventType}</div>

        <div className="text-muted-foreground">Storage</div>
        <div>
          {kind >= EPHEMERAL_START && kind < EPHEMERAL_END
            ? "Not stored (ephemeral)"
            : "Stored by relays"}
        </div>

        {kind >= PARAMETERIZED_REPLACEABLE_START &&
          kind < PARAMETERIZED_REPLACEABLE_END && (
            <>
              <div className="text-muted-foreground">Identifier</div>
              <code className="font-mono text-xs">d-tag</code>
            </>
          )}

        {kindInfo.nip && (
          <>
            <div className="text-muted-foreground">Defined in</div>
            <div>
              <Command
                name={`NIP-${kindInfo.nip}`}
                description={`View NIP-${kindInfo.nip} specification`}
                appId="nip"
                props={{ number: kindInfo.nip }}
              />
            </div>
          </>
        )}
      </div>

      {/* GitHub Link */}
      {kindInfo.nip && (
        <div className="pt-4 border-t border-border">
          <a
            href={`https://github.com/nostr-protocol/nips/blob/master/${kindInfo.nip.padStart(
              2,
              "0",
            )}.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            View on GitHub
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * Get the category of an event kind
 */
function getKindCategory(kind: number): string {
  if (kind >= 0 && kind <= 10) return "Core Protocol";
  if (kind >= 11 && kind <= 19) return "Communication";
  if (kind >= 20 && kind <= 39) return "Media & Content";
  if (kind >= 40 && kind <= 49) return "Channels";
  if (kind >= 1000 && kind <= 9999) return "Application Specific";
  if (kind >= REPLACEABLE_START && kind < REPLACEABLE_END)
    return "Regular Lists";
  if (kind >= EPHEMERAL_START && kind < EPHEMERAL_END)
    return "Ephemeral Events";
  if (
    kind >= PARAMETERIZED_REPLACEABLE_START &&
    kind < PARAMETERIZED_REPLACEABLE_END
  )
    return "Parameterized Replaceable";
  if (kind >= 40000) return "Custom/Experimental";
  return "Other";
}

/**
 * Determine the replaceability of an event kind
 */
function getEventType(kind: number): string {
  if (
    kind === kinds.Metadata ||
    kind === kinds.Contacts ||
    (kind >= REPLACEABLE_START && kind < REPLACEABLE_END)
  ) {
    return "Replaceable";
  }
  if (
    kind >= PARAMETERIZED_REPLACEABLE_START &&
    kind < PARAMETERIZED_REPLACEABLE_END
  ) {
    return "Parameterized Replaceable";
  }
  if (kind >= EPHEMERAL_START && kind < EPHEMERAL_END) {
    return "Ephemeral";
  }
  return "Regular";
}
