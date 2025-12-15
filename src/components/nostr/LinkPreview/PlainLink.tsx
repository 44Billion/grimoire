import { cn } from "@/lib/utils";

interface PlainLinkProps {
  url: string;
  className?: string;
}

export function PlainLink({ url, className }: PlainLinkProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  // Format URL for display: remove scheme and trailing slashes
  const displayUrl = url
    .replace(/^https?:\/\//, "") // Remove http:// or https://
    .replace(/\/$/, ""); // Remove trailing slash

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-muted-foreground underline decoration-dotted cursor-crosshair hover:text-foreground break-all",
        className,
      )}
      onClick={handleClick}
    >
      {displayUrl}
    </a>
  );
}
