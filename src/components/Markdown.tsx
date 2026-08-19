/**
 * Markdown, rendered the one way this app renders it.
 *
 * A model answers in markdown — headings, fenced code, tables, the occasional
 * formula — and anything that shows a model's output and does not parse markdown
 * is showing the reader asterisks and backticks. `RichText` is the wrong tool
 * here: it is grimoire's NOSTR content renderer (mentions, hashtags, `nostr:`
 * references, media embeds), and a kind-1 note is not a transcript.
 *
 * This is deliberately a single component rather than one per window. The `ai`
 * window and an agent's published transcript are the same object seen from two
 * ends — one being written, one being read — so a difference in how they render
 * is a bug waiting to be reported as "the shared copy looks wrong". `ai-elements`
 * wraps this rather than reaching for `Streamdown` a second time.
 *
 * Memoised on the text alone: a streaming answer re-renders on every fragment,
 * and highlighting a code block is not free.
 */

import { memo } from "react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";

import { cn } from "@/lib/utils";

/** The plugin set, hoisted so it is one object for the life of the module. */
const PLUGINS = { cjk, code, math, mermaid };

export interface MarkdownProps {
  children: string;
  className?: string;
}

export const Markdown = memo(
  ({ children, className }: MarkdownProps) => (
    <Streamdown
      className={cn(
        "size-full text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      plugins={PLUGINS}
    >
      {children}
    </Streamdown>
  ),
  (before, after) => before.children === after.children,
);
Markdown.displayName = "Markdown";
