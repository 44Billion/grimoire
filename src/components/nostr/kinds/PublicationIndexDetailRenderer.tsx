import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink as ExternalLinkIcon,
  Loader2,
} from "lucide-react";
import { getTagValue, getReplaceableIdentifier } from "applesauce-core/helpers";
import { UserName } from "../UserName";
import { MediaEmbed } from "../MediaEmbed";
import { ExternalIdentifierInline } from "../ExternalIdentifierDisplay";
import { KindBadge } from "@/components/KindBadge";
import { NIPBadge } from "@/components/NIPBadge";
import { Label } from "@/components/ui/label";
import { useAddWindow } from "@/core/state";
import { useBatchedAddressableEvent } from "@/hooks/useNostrEvent";
import { getEventDisplayTitle } from "@/lib/event-title";
import { formatISODate } from "@/lib/locale-utils";
import {
  getPublicationAuthors,
  getPublicationDerivative,
  getPublicationEntries,
  getPublicationExternalIds,
  getPublicationHashtags,
  getPublicationMeta,
  getPublicationNormalizedTitle,
  getPublicationType,
  isPublicationLeafKind,
  PUBLICATION_INDEX_KIND,
  type PublicationEntry,
  type PublicationOrigin,
} from "@/lib/nkbip01-helpers";
import type { NostrEvent } from "@/types/nostr";

/** Nested indices are legal; this bounds an accidental deep chain. */
const MAX_TOC_DEPTH = 5;

/**
 * Detail renderer for Kind 30040 - Publication Index (NKBIP-01)
 *
 * The content field is empty by spec: metadata and the ordered `a` tags that
 * form the table of contents are the whole event.
 */
export function PublicationIndexDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const title =
    getTagValue(event, "title") ||
    getTagValue(event, "d") ||
    "Untitled publication";
  const normalizedTitle = getPublicationNormalizedTitle(event);
  const authors = getPublicationAuthors(event);
  const entries = getPublicationEntries(event);
  const hashtags = getPublicationHashtags(event);
  const externalIds = getPublicationExternalIds(event);
  const derivative = getPublicationDerivative(event);
  const type = getPublicationType(event);
  const { version, publishedOn, publishedBy, image, summary, source } =
    getPublicationMeta(event);

  const rootAncestors = useMemo(
    () => [
      `${event.kind}:${event.pubkey}:${getReplaceableIdentifier(event) ?? ""}`,
    ],
    [event],
  );

  return (
    <div dir="auto" className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        {image && (
          <MediaEmbed
            url={image}
            preset="preview"
            enableZoom
            className="w-full rounded-lg overflow-hidden"
          />
        )}

        <h1 className="text-3xl font-bold">{title}</h1>

        {normalizedTitle && normalizedTitle !== title && (
          <div className="text-xs font-mono text-muted-foreground">
            {normalizedTitle}
          </div>
        )}

        {summary && <p className="text-lg text-muted-foreground">{summary}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind={PUBLICATION_INDEX_KIND} variant="full" clickable />
          <NIPBadge nipNumber="NKBIP-01" showNIPPrefix={false} />
          <Label>{type}</Label>
          {version && <Label>{version}</Label>}
          {publishedOn && <Label>{formatISODate(publishedOn)}</Label>}
          {publishedBy && <Label>{publishedBy}</Label>}
        </div>

        {authors.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {authors.map((author, index) => (
              <span
                key={`${author.name}-${index}`}
                className="flex items-center gap-1.5"
              >
                <span className="font-semibold">{author.name}</span>
                {author.role && <Label>{author.role}</Label>}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Published by</span>
          <UserName pubkey={event.pubkey} className="font-semibold" />
        </div>

        {externalIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {externalIds.map((id) => (
              <ExternalIdentifierInline key={id} value={id} />
            ))}
          </div>
        )}

        {source && (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground underline decoration-dotted hover:text-foreground w-fit"
          >
            <ExternalLinkIcon className="size-3" />
            <span className="break-all">{source}</span>
          </a>
        )}

        {hashtags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {hashtags.map((tag) => (
              <Label key={tag}>#{tag}</Label>
            ))}
          </div>
        )}

        {event.content.trim() && (
          <Label className="w-fit" size="md">
            content should be empty (NKBIP-01)
          </Label>
        )}
      </header>

      {derivative && <DerivedFrom origins={derivative.origins} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold">
          Contents{entries.length > 0 && ` (${entries.length})`}
        </h2>
        {entries.length === 0 ? (
          <div className="border border-border p-4 text-sm text-muted-foreground italic">
            Stub index — no sections listed yet.
          </div>
        ) : (
          <TocList entries={entries} ancestors={rootAncestors} depth={0} />
        )}
      </section>
    </div>
  );
}

function DerivedFrom({ origins }: { origins: PublicationOrigin[] }) {
  const addWindow = useAddWindow();

  return (
    <section className="flex flex-col gap-2 border border-border p-4">
      <h2 className="text-sm font-bold">Derived from</h2>
      {origins.map(({ pubkey, event }, index) => (
        <div
          key={`${pubkey ?? ""}:${event?.id ?? index}`}
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          {pubkey && <UserName pubkey={pubkey} />}
          {event && (
            <button
              onClick={() =>
                addWindow("open", {
                  // Carry kind and author so adapters dispatch without a fetch
                  pointer: {
                    id: event.id,
                    kind: PUBLICATION_INDEX_KIND,
                    author: event.pubkey ?? pubkey,
                    relays: event.relay ? [event.relay] : undefined,
                  },
                })
              }
              className="text-accent underline decoration-dotted cursor-crosshair"
            >
              Open the original
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function TocList({
  entries,
  ancestors,
  depth,
}: {
  entries: PublicationEntry[];
  ancestors: readonly string[];
  depth: number;
}) {
  return (
    <ol className="flex flex-col gap-1">
      {entries.map((entry, index) => (
        <TocRow
          key={`${entry.coordinate}:${index}`}
          entry={entry}
          index={index}
          ancestors={ancestors}
          depth={depth}
        />
      ))}
    </ol>
  );
}

function TocRow({
  entry,
  index,
  ancestors,
  depth,
}: {
  entry: PublicationEntry;
  index: number;
  ancestors: readonly string[];
  depth: number;
}) {
  const addWindow = useAddWindow();
  // Batched: an index can list 100+ sections, and a REQ each makes relays
  // rate-limit so the tail of the list never resolves.
  const target = useBatchedAddressableEvent(entry.pointer);
  const [expanded, setExpanded] = useState(false);

  // Path-dependent, so it has to be threaded down rather than shared: two
  // siblings in the same list have different ancestor chains.
  const childAncestors = useMemo(
    () => [...ancestors, entry.coordinate],
    [ancestors, entry.coordinate],
  );

  const isCycle = ancestors.includes(entry.coordinate);
  const atMaxDepth = depth >= MAX_TOC_DEPTH;
  const isNestedIndex = entry.pointer.kind === PUBLICATION_INDEX_KIND;
  const canExpand = isNestedIndex && !isCycle && !atMaxDepth;

  const label = target
    ? getEventDisplayTitle(target, false) || entry.pointer.identifier
    : entry.pointer.identifier;

  const open = () => addWindow("open", { pointer: entry.pointer });

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-2 text-sm py-0.5">
        <span className="font-mono text-xs text-muted-foreground w-6 text-right shrink-0">
          {index + 1}.
        </span>

        {canExpand ? (
          <button
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="text-muted-foreground hover:text-foreground cursor-crosshair shrink-0"
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}

        <KindBadge
          kind={entry.pointer.kind}
          variant="compact"
          className="shrink-0"
          iconClassname="shrink-0"
        />

        <button
          onClick={open}
          className="text-left hover:underline hover:decoration-dotted cursor-crosshair truncate"
        >
          {label}
        </button>

        {!target && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Loader2 className="size-3 animate-spin" />
            Loading…
          </span>
        )}

        {!isPublicationLeafKind(entry.pointer.kind) && (
          <Label title="NKBIP-01 does not list this kind as a publication section">
            unexpected kind
          </Label>
        )}

        {isCycle && (
          <Label title="This index is already an ancestor of this row">
            cycle
          </Label>
        )}

        {!isCycle && isNestedIndex && atMaxDepth && (
          <Label title="Nesting limit reached — open this index in its own window">
            max depth
          </Label>
        )}
      </div>

      {expanded && target && (
        <div className="pl-6 border-l border-border ml-3">
          <TocList
            entries={getPublicationEntries(target)}
            ancestors={childAncestors}
            depth={depth + 1}
          />
        </div>
      )}
    </li>
  );
}
