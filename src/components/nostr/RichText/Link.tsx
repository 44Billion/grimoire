import { useState } from "react";
import {
  isImageURL,
  isVideoURL,
  isAudioURL,
} from "applesauce-core/helpers/url";
import { MediaDialog } from "../MediaDialog";
import { MediaEmbed } from "../MediaEmbed";
import { PlainLink } from "../LinkPreview";

interface LinkNodeProps {
  node: {
    href: string;
  };
}

export function Link({ node }: LinkNodeProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { href } = node;

  const handleAudioClick = () => {
    setDialogOpen(true);
  };

  // Render appropriate link type
  if (isImageURL(href)) {
    return (
      <MediaEmbed
        url={href}
        type="image"
        preset="inline"
        enableZoom
        className="inline-block"
      />
    );
  }

  if (isVideoURL(href)) {
    return (
      <MediaEmbed
        url={href}
        type="video"
        preset="inline"
        className="inline-block"
      />
    );
  }

  if (isAudioURL(href)) {
    return (
      <>
        <MediaEmbed
          url={href}
          type="audio"
          onAudioClick={handleAudioClick}
          className="inline-block"
        />
        <MediaDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          urls={[href]}
          initialIndex={0}
        />
      </>
    );
  }

  // Plain link for non-media URLs
  return <PlainLink url={href} />;
}
