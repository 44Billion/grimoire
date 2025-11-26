import { X } from "lucide-react";
import { Button } from "./ui/button";

interface WindowToolbarProps {
  onClose?: () => void;
}

export function WindowToolbar({ onClose }: WindowToolbarProps) {
  return (
    <div className="flex items-center gap-1">
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}
