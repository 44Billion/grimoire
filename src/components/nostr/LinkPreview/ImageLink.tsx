import { Image } from "lucide-react";

interface ImageLinkProps {
  url: string;
  onClick: () => void;
}

export function ImageLink({ url, onClick }: ImageLinkProps) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-baseline gap-1 text-muted-foreground underline decoration-dotted hover:text-foreground cursor-crosshair break-all line-clamp-1"
    >
      <Image className="h-3 w-3 flex-shrink-0" />
      <span>{url}</span>
    </button>
  );
}
