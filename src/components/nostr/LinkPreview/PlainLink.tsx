import { ExternalLink } from "lucide-react";

interface PlainLinkProps {
  url: string;
}

export function PlainLink({ url }: PlainLinkProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-baseline gap-1 text-muted-foreground underline decoration-dotted hover:text-foreground cursor-crosshair break-all"
    >
      <ExternalLink className="h-3 w-3 flex-shrink-0" />
      <span>{url}</span>
    </a>
  );
}
