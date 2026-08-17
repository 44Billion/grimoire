import { CodeCopyButton } from "@/components/CodeCopyButton";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import { useCopy } from "@/hooks/useCopy";

/**
 * A code block in Hex's reply, rendered the way grimoire renders code
 * everywhere else: Shiki via `SyntaxHighlight`, and copyable.
 *
 * The wrapper is `max-w-full` with its own horizontal scroll so a long line
 * scrolls inside the block instead of widening the window — a pane in a tiling
 * layout has no room to grow into.
 */
export function ReplyCodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const { copy, copied } = useCopy();

  return (
    <div className="group relative my-2 max-w-full overflow-hidden rounded border border-border bg-muted/30">
      <SyntaxHighlight
        className="max-w-full overflow-x-auto p-2"
        code={code}
        language={language}
      />
      <CodeCopyButton
        className="opacity-0 transition-opacity group-hover:opacity-100"
        copied={copied}
        onCopy={() => copy(code)}
      />
    </div>
  );
}
