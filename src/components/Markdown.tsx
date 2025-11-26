import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { useGrimoire } from "@/core/state";
import { MediaEmbed } from "@/components/nostr/MediaEmbed";

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className = "" }: MarkdownProps) {
  const { addWindow } = useGrimoire();

  const components: Components = {
    // Headings
    h1: ({ children }) => (
      <h1 className="text-lg font-bold mt-4 mb-3 first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-base font-bold mt-4 mb-2 first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-sm font-bold mt-3 mb-2 first:mt-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-sm font-bold mt-3 mb-2 first:mt-0">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-xs font-bold mt-2 mb-1 first:mt-0">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-xs font-bold mt-2 mb-1 first:mt-0">{children}</h6>
    ),

    // Paragraphs and text
    p: ({ children }) => (
      <p className="mb-3 leading-relaxed text-sm last:mb-0 break-words">
        {children}
      </p>
    ),

    // Links
    a: ({ href, children }) => {
      // Check if it's a relative NIP link (e.g., "./01.md" or "01.md")
      if (href && (href.endsWith(".md") || href.includes(".md#"))) {
        // Extract NIP number from various formats
        const nipMatch = href.match(/(\d{2})\.md/);
        if (nipMatch) {
          const nipNumber = nipMatch[1];
          return (
            <span
              onClick={(e) => {
                e.preventDefault();
                addWindow("nip", { number: nipNumber }, `NIP ${nipNumber}`);
              }}
              className="text-primary underline decoration-dotted cursor-pointer hover:text-primary/80 transition-colors"
            >
              {children}
            </span>
          );
        }
      }

      // Regular external link
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline decoration-dotted cursor-crosshair hover:text-primary/80 transition-colors"
        >
          {children}
        </a>
      );
    },

    // Lists
    ul: ({ children }) => (
      <ul className="list-disc list-inside mb-3 space-y-1 text-sm">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-inside mb-3 space-y-1 text-sm">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-muted-foreground/30 pl-3 py-2 my-3 italic text-muted-foreground text-sm">
        {children}
      </blockquote>
    ),

    // Code
    code: (props) => {
      const { children, className } = props;
      const inline = !className?.includes("language-");
      return inline ? (
        <code className="bg-muted px-1.5 py-0.5 rounded text-xs break-all">
          {children}
        </code>
      ) : (
        <code className="block bg-muted p-3 rounded-lg my-3 overflow-x-auto text-xs leading-relaxed max-w-full">
          {children}
        </code>
      );
    },
    pre: ({ children }) => <pre className="my-3">{children}</pre>,

    // Horizontal rule
    hr: () => <hr className="my-4 border-border" />,

    // Tables
    table: ({ children }) => (
      <div className="overflow-x-auto my-3">
        <table className="min-w-full border-collapse border border-border text-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr className="border-b border-border">{children}</tr>
    ),
    th: ({ children }) => (
      <th className="px-3 py-1.5 text-left font-bold border border-border">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-1.5 border border-border">{children}</td>
    ),

    // Images - Inline with zoom
    img: ({ src, alt }) =>
      src ? (
        <MediaEmbed
          url={src}
          alt={alt}
          preset="preview"
          enableZoom
          className="my-3"
        />
      ) : null,

    // Emphasis
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
  };

  return (
    <div className={className}>
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  );
}
