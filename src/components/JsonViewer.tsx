import { useState } from "react";
import { Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface JsonViewerProps {
  data: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

export function JsonViewer({
  data,
  open,
  onOpenChange,
  title = "Raw JSON",
}: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const jsonString = JSON.stringify(data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between pr-8">
            <span>{title}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="gap-2"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy
                </>
              )}
            </Button>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto mt-2">
          <pre className="text-xs font-mono bg-muted p-4 overflow-scroll">
            {jsonString}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
