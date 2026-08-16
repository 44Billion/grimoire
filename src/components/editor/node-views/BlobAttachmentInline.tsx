import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { FileIcon, Film, ImageIcon, Music } from "lucide-react";
import { formatBlobSize } from "../utils/serialize";

/**
 * Inline badge-style node view for blob attachments (used in MentionEditor)
 *
 * Shows a compact badge with media type icon, label, and size. No thumbnail:
 * the blob may not be fetchable (encrypted, auth-gated) and 16px conveys nothing.
 */
export function BlobAttachmentInline({ node }: ReactNodeViewProps) {
  const { mimeType, size } = node.attrs as {
    url: string;
    sha256: string;
    mimeType: string | null;
    size: number | null;
    server: string | null;
  };

  const mediaType = mimeType?.split("/")[0];

  const { Icon, typeLabel } =
    mediaType === "image"
      ? { Icon: ImageIcon, typeLabel: "image" }
      : mediaType === "video"
        ? { Icon: Film, typeLabel: "video" }
        : mediaType === "audio"
          ? { Icon: Music, typeLabel: "audio" }
          : { Icon: FileIcon, typeLabel: "file" };

  return (
    <NodeViewWrapper
      as="span"
      className="blob-attachment inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 border border-border text-xs align-middle"
      contentEditable={false}
    >
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground truncate max-w-[80px]">
        {typeLabel}
      </span>
      {size != null && (
        <span className="text-muted-foreground/70">{formatBlobSize(size)}</span>
      )}
    </NodeViewWrapper>
  );
}
