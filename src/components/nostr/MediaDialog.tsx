import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  isImageURL,
  isVideoURL,
  isAudioURL,
} from "applesauce-core/helpers/url";

interface MediaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  urls: string[];
  initialIndex?: number;
}

/**
 * Dialog for viewing media (images, videos, audio)
 * Supports gallery navigation when multiple URLs provided
 */
export function MediaDialog({
  open,
  onOpenChange,
  urls,
  initialIndex = 0,
}: MediaDialogProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const currentUrl = urls[currentIndex];
  const isGallery = urls.length > 1;

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : urls.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < urls.length - 1 ? prev + 1 : 0));
  };

  const renderMedia = (url: string) => {
    if (isImageURL(url)) {
      return (
        <img
          src={url}
          alt="Media content"
          className="max-w-full max-h-[80vh] object-contain mx-auto"
        />
      );
    }

    if (isVideoURL(url)) {
      return (
        <video
          src={url}
          controls
          className="max-w-full max-h-[80vh] mx-auto"
          autoPlay
        />
      );
    }

    if (isAudioURL(url)) {
      return (
        <div className="flex flex-col items-center gap-4 p-8">
          <audio src={url} controls autoPlay className="w-full max-w-md" />
          <p className="text-sm text-muted-foreground break-all">{url}</p>
        </div>
      );
    }

    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Unable to preview this media type
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline text-sm mt-2 inline-block"
        >
          Open in new tab
        </a>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl">
        <DialogHeader>
          <DialogTitle>
            {isGallery
              ? `Media ${currentIndex + 1} of ${urls.length}`
              : "Media"}
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          {renderMedia(currentUrl)}

          {isGallery && (
            <>
              <button
                onClick={handlePrevious}
                className="absolute left-4 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border border-border rounded-sm p-2"
                aria-label="Previous media"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                onClick={handleNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background border border-border rounded-sm p-2"
                aria-label="Next media"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
