import { createContext, useContext, useMemo } from "react";
import { nip19 } from "nostr-tools";
import { cn } from "@/lib/utils";
import { useAddWindow } from "@/core/state";
import {
  normalizeWikiTarget,
  PUBLICATION_SECTION_KIND,
} from "@/lib/nkbip01-helpers";
import {
  parseAsciiDoc,
  type AsciiDocBlock,
  type AsciiDocInline,
  type AsciiDocListBlock,
} from "@/lib/asciidoc";
import { MediaEmbed } from "./MediaEmbed";
import { CodeBlock } from "./MarkdownContent";
import { Mention } from "./RichText/Mention";

/**
 * Renders AsciiDoc content — NKBIP-01 publication sections (kind 30041) and,
 * later, NIP-54 wiki articles.
 *
 * Deliberately mirrors MarkdownContent's class vocabulary so a section and an
 * article look like the same app. Headings are shifted down one level: the
 * detail renderer already emits the section title as the page <h1>.
 */

/**
 * The author of the document being rendered. `{{ref:…}}` targets are bare
 * d-tags, so resolving one needs the pubkey it was written under; that is
 * uniform for the whole subtree, which is what a context is for.
 */
const AuthorContext = createContext<string | undefined>(undefined);

export interface AsciiDocContentProps {
  content: string;
  /** Author of the event, so `{{ref:…}}` macros can resolve to siblings */
  authorPubkey?: string;
  className?: string;
}

export function AsciiDocContent({
  content,
  authorPubkey,
  className,
}: AsciiDocContentProps) {
  const doc = useMemo(() => parseAsciiDoc(content), [content]);

  return (
    <AuthorContext.Provider value={authorPubkey}>
      <article
        dir="auto"
        className={cn("prose prose-invert prose-sm max-w-none", className)}
      >
        {doc.blocks.map((block, index) => (
          <BlockNode key={index} block={block} />
        ))}
      </article>
    </AuthorContext.Provider>
  );
}

function BlockNode({ block }: { block: AsciiDocBlock }) {
  switch (block.type) {
    case "heading":
      return <Heading level={block.level} inlines={block.inlines} />;

    case "paragraph":
      return (
        <p className="text-sm leading-relaxed mb-4">
          <Inlines nodes={block.inlines} />
        </p>
      );

    case "list":
      return <ListBlock block={block} />;

    case "listing":
      return <CodeBlock code={block.text} language={block.language ?? null} />;

    case "quote":
      return (
        <blockquote className="border-l-4 border-muted pl-4 italic text-muted-foreground my-4">
          {block.blocks.map((child, index) => (
            <BlockNode key={index} block={child} />
          ))}
        </blockquote>
      );

    case "image":
      return (
        <MediaEmbed
          url={block.url}
          alt={block.alt}
          preset="preview"
          enableZoom
          className="my-4"
        />
      );

    case "break":
      return <hr className="my-4" />;
  }
}

function Heading({
  level,
  inlines,
}: {
  level: number;
  inlines: AsciiDocInline[];
}) {
  const children = <Inlines nodes={inlines} />;

  if (level <= 1)
    return <h2 className="text-2xl font-bold mt-8 mb-4">{children}</h2>;
  if (level === 2)
    return <h3 className="text-xl font-bold mt-6 mb-3">{children}</h3>;
  return <h4 className="text-lg font-bold mt-4 mb-2">{children}</h4>;
}

function ListBlock({ block }: { block: AsciiDocListBlock }) {
  const items = block.items.map((item, index) => (
    <li key={index}>
      <Inlines nodes={item.inlines} />
      {item.children && <ListBlock block={item.children} />}
    </li>
  ));

  return block.ordered ? (
    <ol className="text-sm list-decimal list-inside my-4 space-y-2">{items}</ol>
  ) : (
    <ul className="text-sm list-disc list-inside my-4 space-y-2">{items}</ul>
  );
}

function Inlines({ nodes }: { nodes: AsciiDocInline[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineNode key={index} node={node} />
      ))}
    </>
  );
}

function InlineNode({ node }: { node: AsciiDocInline }) {
  switch (node.type) {
    case "text":
      return <>{node.value}</>;

    case "strong":
      return (
        <strong>
          <Inlines nodes={node.children} />
        </strong>
      );

    case "em":
      return (
        <em>
          <Inlines nodes={node.children} />
        </em>
      );

    case "code":
      return (
        <code className="bg-muted px-0.5 py-0.5 rounded text-xs font-mono">
          {node.value}
        </code>
      );

    case "link":
      return (
        <a
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline decoration-dotted break-all"
        >
          {node.text}
        </a>
      );

    case "wikilink":
      return <WikiLink target={node.target} label={node.label} />;

    case "nostr":
      return <NostrReference encoded={node.encoded} />;

    case "macro":
      return node.name === "ref" ? (
        <SectionRef target={node.target} label={node.label} />
      ) : (
        <>{node.label}</>
      );
  }
}

/**
 * `{{ref:<d-tag>|Label}}` points at another section of the same corpus by the
 * same author — the publishing client also mirrors each one into a `ref` tag.
 * Without a known author there is no pointer to build, so show the label.
 */
function SectionRef({ target, label }: { target: string; label: string }) {
  const addWindow = useAddWindow();
  const authorPubkey = useContext(AuthorContext);

  if (!authorPubkey) return <>{label}</>;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addWindow("open", {
      pointer: {
        kind: PUBLICATION_SECTION_KIND,
        pubkey: authorPubkey,
        identifier: target,
      },
    });
  };

  return (
    <button
      onClick={handleClick}
      title={target}
      className="text-accent underline decoration-dotted cursor-crosshair text-left"
    >
      {label}
    </button>
  );
}

function NostrReference({ encoded }: { encoded: string }) {
  let decoded: nip19.DecodedResult | undefined;
  try {
    decoded = nip19.decode(encoded);
  } catch {
    return <>nostr:{encoded}</>;
  }
  return <Mention node={{ decoded, encoded }} />;
}

/**
 * A [[wikilink]] names a topic, not an author — there is no pubkey to build a
 * pointer from — so clicking one runs a query for everyone who wrote that page.
 * Relays are left out on purpose: ReqViewer then does NIP-65 selection itself.
 */
function WikiLink({ target, label }: { target: string; label: string }) {
  const addWindow = useAddWindow();
  const slug = normalizeWikiTarget(target);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addWindow(
      "req",
      { filter: { kinds: [30818, 30041], "#d": [slug], limit: 50 } },
      `req -k 30818,30041 -d ${slug}`,
      label,
    );
  };

  return (
    <button
      onClick={handleClick}
      title={`Wiki link: ${slug}`}
      className="text-accent underline decoration-dotted cursor-crosshair"
    >
      {label}
    </button>
  );
}
