/**
 * What a run is about, rendered as the thing itself.
 *
 * A session scoped to a repository carries an `a` pointing at its kind-30617;
 * one opened from an event carries an `e`. Those pointers are what the agent
 * was grounded in — it resolved them before its first token — so a reader
 * looking at the transcript should see the same thing the agent saw, and see it
 * as a repository or a note rather than as a coordinate.
 *
 * Not only events. NIP-22's scope vocabulary already names the rest: a person
 * (`p`), a page on the web (`r`), and something that lives outside Nostr
 * entirely (`i`, NIP-73) — a GitHub issue, an ISBN, a package. Anything this
 * build cannot place is printed as written, which is the honest thing to do
 * with a pointer written by a client that knows something we do not.
 *
 * Placed under the setup deliberately: the prompt and the tools are what the
 * agent IS, and this is what it was pointed at. Both are inputs to the run and
 * neither is part of the conversation, so they sit together above it.
 *
 * Renders NOTHING when a run names no subject, which is most of them.
 */

import { ExternalLink, Hash } from "lucide-react";

import { EmbeddedEvent } from "@/components/nostr/EmbeddedEvent";
import { UserName } from "@/components/nostr/UserName";
import { Label } from "@/components/ui/label";

export function SessionSubjects({ subjects }: { subjects: string[][] }) {
  const rows = subjects.filter((tag) => tag[1]);
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        About
      </h3>
      {rows.map((tag, at) => (
        <Subject key={`${tag[0]}:${tag[1]}:${at}`} tag={tag} />
      ))}
    </section>
  );
}

function Subject({ tag }: { tag: string[] }) {
  const [name, value, hint] = tag;
  // The relay hint is carried through: a repository announcement lives where
  // its maintainer put it, which is very often nowhere the reader's own relays
  // would have it.
  const relays = hint && /^wss?:\/\//i.test(hint) ? [hint] : undefined;
  const framed = "overflow-hidden rounded border border-border";

  if (name === "e" && value && /^[0-9a-f]{64}$/i.test(value))
    return (
      <EmbeddedEvent eventPointer={{ id: value, relays }} className={framed} />
    );

  if (name === "a" && value) {
    const [kind, pubkey, identifier = ""] = value.split(":");
    const number = Number(kind);
    if (Number.isInteger(number) && pubkey)
      return (
        <EmbeddedEvent
          addressPointer={{ kind: number, pubkey, identifier, relays }}
          className={framed}
        />
      );
  }

  if (name === "p" && value && /^[0-9a-f]{64}$/i.test(value))
    return (
      <div className="rounded border border-dotted border-border p-2 text-sm">
        <UserName pubkey={value} relayHints={relays} />
      </div>
    );

  if (name === "r" && value)
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-1.5 rounded border border-dotted border-border p-2 text-xs break-all hover:text-foreground"
      >
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
        {value}
      </a>
    );

  /**
   * NIP-73, and anything else.
   *
   * An external id has nothing to fetch and nothing to decode — what it has is
   * a name and, often, a URL to reach it by. Both are shown, and an unknown tag
   * kind lands here too rather than being dropped: a pointer this build cannot
   * place is still something the agent was told about.
   */
  return (
    <div className="flex items-center gap-1.5 rounded border border-dotted border-border p-2 text-xs">
      <Hash className="h-3 w-3 shrink-0 text-muted-foreground" />
      <Label size="sm">{name}</Label>
      <span className="truncate font-mono">{value}</span>
      {hint && /^https?:\/\//i.test(hint) && (
        <a
          href={hint}
          target="_blank"
          rel="noreferrer noopener"
          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
