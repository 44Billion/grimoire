import { Video } from "lucide-react";

interface VideoLinkProps {
  url: string;
  onClick: () => void;
}

export function VideoLink({ url, onClick }: VideoLinkProps) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-baseline gap-1 text-muted-foreground underline decoration-dotted hover:text-foreground cursor-crosshair break-all line-clamp-1"
    >
      <Video className="h-3 w-3 flex-shrink-0" />
      <span>{url}</span>
    </button>
  );
}
