/**
 * The box you type a message into — one component, mounted once per place a
 * message can be sent from.
 *
 * It exists because there are two of those now: the channel's, at the bottom of
 * the timeline, and the thread's, at the bottom of the pane. Everything a
 * composer owns is per-instance and cannot be shared between them:
 *
 * - **The editor handle.** One `editorRef` served both while this lived in
 *   `ChatViewer`, so an upload finished in one box was inserted into whichever
 *   editor had claimed the ref, and the draft restore polled that same ref.
 * - **The upload dialog.** `useBlossomUpload` inserts its result through the
 *   handle above, so the two are one unit.
 * - **The draft.** Keyed per composer, so a half-typed thread reply and a
 *   half-typed channel message no longer overwrite each other.
 *
 * What is deliberately NOT per-instance is `isSending` and the encryption map,
 * both of which the caller owns: a signer takes one request at a time, and the
 * AES-GCM params for an attachment have to reach `sendMessage` whichever box the
 * file was attached in.
 */

import { useCallback, useEffect, useRef } from "react";
import { Loader2, Paperclip } from "lucide-react";
import {
  MentionEditor,
  type MentionEditorHandle,
  type EmojiTag,
  type BlobAttachment,
} from "@/components/editor/MentionEditor";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ComposerReplyPreview } from "./ComposerReplyPreview";
import { useBlossomUpload } from "@/hooks/useBlossomUpload";
import {
  prepareAttachment,
  type EncryptedUpload,
} from "@/lib/concord/attachment-upload";
import type { BlobAttachmentMeta } from "@/lib/chat/adapters/base-adapter";
import {
  clearDraft,
  draftsReady,
  readDraft,
  shouldRestoreDraft,
  writeDraft,
} from "@/services/chat-drafts";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { ChatAction } from "@/types/chat-actions";
import type { ChatProtocol, Conversation } from "@/types/chat";
import type { ProfileSearchResult } from "@/services/profile-search";
import type { EmojiSearchResult } from "@/services/emoji-search";

/**
 * How long typing must pause before the draft is written to disk.
 *
 * Only the WRITE waits — the document is mirrored in memory on every keystroke,
 * so a channel switch or a closed window saves what was typed a moment ago
 * rather than what was typed a debounce ago.
 */
const DRAFT_SAVE_MS = 750;

export interface ChatComposerHandle {
  focus(): void;
}

export interface ChatComposerProps {
  adapter: ChatProtocolAdapter;
  conversation: Conversation;
  protocol: ChatProtocol;
  placeholder: string;
  /**
   * The key this composer's draft is stored under, or undefined for no draft at
   * all — which is what a composer with no signed-in account gets.
   */
  draftKey?: string;
  /** The message being replied to. Fixed for a thread, chosen for a channel. */
  replyTo?: string;
  /**
   * Change the reply target. Absent means the target is not the reader's to
   * change — the thread pane, whose target is the thread itself — and that also
   * turns off the banner and the stale-parent check, both of which exist to let
   * a reader see and undo a choice they made.
   */
  onReplyToChange?: (replyToId: string | undefined) => void;
  onSend: (
    content: string,
    replyToId: string | undefined,
    emojiTags: EmojiTag[],
    blobAttachments: BlobAttachment[],
  ) => Promise<void>;
  /** Shared across every composer: one signer, one request at a time. */
  isSending: boolean;
  /** Shared for the same reason — see the module docstring. */
  attachmentEncryption: React.RefObject<
    Map<string, Pick<BlobAttachmentMeta, "encryption" | "originalMime">>
  >;
  searchProfiles: (query: string) => Promise<ProfileSearchResult[]>;
  searchEmojis: (query: string) => Promise<EmojiSearchResult[]>;
  searchCommands?: (query: string) => Promise<ChatAction[]>;
  onCommandExecute?: (action: ChatAction) => Promise<void>;
  /** Set by the caller so "Reply" can put the cursor here. */
  handleRef?: React.RefObject<ChatComposerHandle | null>;
}

export function ChatComposer({
  adapter,
  conversation,
  protocol,
  placeholder,
  draftKey,
  replyTo,
  onReplyToChange,
  onSend,
  isSending,
  attachmentEncryption,
  searchProfiles,
  searchEmojis,
  searchCommands,
  onCommandExecute,
  handleRef,
}: ChatComposerProps) {
  const editorRef = useRef<MentionEditorHandle>(null);

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = { focus: () => editorRef.current?.focus() };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  /** The most recent prepared upload, awaiting the URL it lands on. */
  const preparedUpload = useRef<EncryptedUpload | undefined>(undefined);
  /**
   * A `blob:` URL for the plaintext of that upload, for the composer badge.
   *
   * The uploaded URL serves ciphertext, so the badge cannot draw it. Held only
   * until the badge is inserted, and revoked whenever it is replaced or
   * abandoned — an object URL pins its bytes in memory until it is.
   */
  const preparedPreview = useRef<string | undefined>(undefined);
  const dropPreview = useCallback(() => {
    if (preparedPreview.current) URL.revokeObjectURL(preparedPreview.current);
    preparedPreview.current = undefined;
  }, []);

  const { open: openUpload, dialog: uploadDialog } = useBlossomUpload({
    accept: "image/*,video/*,audio/*",
    // Concord only. Every other protocol here posts to a public channel where
    // an encrypted blob would just be an unreadable one.
    ...(protocol === "concord"
      ? {
          prepareFile: async (file: File) => {
            const prepared = await prepareAttachment(file);
            preparedUpload.current = prepared;
            dropPreview();
            // Only images are ever drawn in the badge; minting a URL for a
            // video would pin its bytes for nothing.
            if (file.type.startsWith("image/")) {
              preparedPreview.current = URL.createObjectURL(file);
            }
            return prepared.file;
          },
        }
      : {}),
    onCancel: () => {
      // A prepared-but-unuploaded file must not outlive its dialog, or the next
      // upload could be tagged with the previous file's key.
      preparedUpload.current = undefined;
      dropPreview();
    },
    onError: () => {
      preparedUpload.current = undefined;
      dropPreview();
    },
    onSuccess: (results) => {
      // Captured before the ref is cleared below: the badge needs to know the
      // server holds ciphertext, and `insertBlob` runs after that clear.
      const wasEncrypted = preparedUpload.current !== undefined;
      const preview = preparedPreview.current;
      if (results.length > 0 && preparedUpload.current) {
        // Every result is the SAME blob mirrored to several servers, so one
        // record per URL keeps a later mirror URL readable too.
        for (const { blob } of results) {
          attachmentEncryption.current?.set(blob.url, {
            encryption: preparedUpload.current.encryption,
            originalMime: preparedUpload.current.originalMime,
          });
        }
        preparedUpload.current = undefined;
      }
      if (results.length > 0 && editorRef.current) {
        const { blob, server } = results[0];
        editorRef.current.insertBlob({
          url: blob.url,
          sha256: blob.sha256,
          mimeType: blob.type,
          size: blob.size,
          server,
          ...(preview ? { previewUrl: preview } : {}),
          ...(wasEncrypted ? { encrypted: true } : {}),
        });
        // Ownership passes to the badge; revoking here would blank it.
        preparedPreview.current = undefined;
        editorRef.current.focus();
      }
    },
  });

  /**
   * The draft, mirrored in memory on every keystroke and written on a pause.
   *
   * The mirror is what makes the save-on-switch complete: a child's cleanup runs
   * before its parent's, so anything reaching for the editor at save time would
   * find it already destroyed.
   */
  const draftDoc = useRef<{ json: unknown; isEmpty: boolean }>({
    json: undefined,
    isEmpty: true,
  });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const savingDraftFor = useRef<string | undefined>(undefined);
  /**
   * The reply target, where a stale closure cannot reach it.
   *
   * tiptap captures `onSubmit` when it configures its extensions, so a send
   * reading the prop directly could name whatever the target was when the editor
   * was built. Written from an effect rather than during render — a submit and a
   * draft flush are both user-triggered, so after-paint is current enough, and
   * writing a ref mid-render is the thing React Compiler flags.
   */
  const replyToRef = useRef<string | undefined>(replyTo);
  useEffect(() => {
    replyToRef.current = replyTo;
  }, [replyTo]);

  // What the restore needs to check a stored reply target against, read through
  // a ref so the restore keys on the draft KEY alone: adding the adapter and the
  // conversation object to its deps would re-run the whole restore on every
  // identity change of either.
  const replyResolve = useRef({ adapter, conversation, onReplyToChange });
  useEffect(() => {
    replyResolve.current = { adapter, conversation, onReplyToChange };
  });

  const flushDraft = useCallback(() => {
    clearTimeout(draftTimer.current);
    const key = savingDraftFor.current;
    if (!key) return;
    const { json, isEmpty } = draftDoc.current;
    // An emptied composer DELETES the row rather than storing an empty
    // document, so a channel with nothing in it has nothing to restore.
    if (isEmpty || json === undefined) clearDraft(key);
    else writeDraft(key, json, replyToRef.current);
  }, []);

  const onEditorChange = useCallback(
    (state: { isEmpty: boolean; json: unknown }) => {
      draftDoc.current = state;
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(flushDraft, DRAFT_SAVE_MS);
    },
    [flushDraft],
  );

  useEffect(() => {
    let cancelled = false;
    savingDraftFor.current = draftKey;
    draftDoc.current = { json: undefined, isEmpty: true };

    /**
     * A restored reply target the channel can no longer answer for clears itself.
     *
     * A draft can outlive its parent by days — deleted, or expired under a
     * disappearing timer — and the composer would otherwise come back reading
     * "Replying to 1a2b3c4d…" with every Send refused for a parent that is gone.
     * The text is kept; only the target goes.
     *
     * Cleared only on a definitive "no such message": a thrown lookup is a relay
     * that could not answer, which is no evidence about the parent at all.
     */
    const degradeReply = async (parentId: string) => {
      const {
        adapter: replyAdapter,
        conversation: replyIn,
        onReplyToChange: clear,
      } = replyResolve.current;
      if (!replyIn || !clear) return;
      let parent;
      try {
        parent = await replyAdapter.loadReplyMessage(replyIn, { id: parentId });
      } catch (error) {
        console.warn("[Chat] could not check the draft's reply parent:", error);
        return;
      }
      if (parent || cancelled) return;
      // The reader may have picked a different message to reply to while the
      // lookup was out; theirs wins.
      if (replyToRef.current !== undefined && replyToRef.current !== parentId)
        return;
      clear(undefined);
    };

    if (draftKey) {
      void (async () => {
        // Cold mount: reading before the cache is warm answers "no draft", and
        // the empty composer would then be saved over the real one.
        await draftsReady();
        if (cancelled) return;
        const draft = readDraft(draftKey);
        // Reply context belongs to the composer it was started in — carrying it
        // across would address a message in another channel entirely. A thread's
        // composer has no choice to restore: its target is the thread.
        replyResolve.current.onReplyToChange?.(draft?.replyToId);
        if (draft?.replyToId) void degradeReply(draft.replyToId);
        if (!draft) return;
        // The composer is mounted a beat after the conversation resolves.
        for (let step = 0; step < 40 && !cancelled; step++) {
          const editor = editorRef.current;
          if (editor) {
            if (shouldRestoreDraft(draft, editor.isEmpty())) {
              editor.setJSON(draft.content);
              draftDoc.current = { json: draft.content, isEmpty: false };
            }
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      })();
    }
    return () => {
      cancelled = true;
      flushDraft();
      savingDraftFor.current = undefined;
    };
  }, [draftKey, flushDraft]);

  return (
    <div className="border-t px-2 py-1 pb-0">
      {replyTo && onReplyToChange && (
        <ComposerReplyPreview
          replyToId={replyTo}
          adapter={adapter}
          conversation={conversation}
          onClear={() => onReplyToChange(undefined)}
        />
      )}
      <div className="flex items-center gap-1.5">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => openUpload()}
                disabled={isSending}
              >
                <Paperclip className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Attach media</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <MentionEditor
          ref={editorRef}
          placeholder={placeholder}
          searchProfiles={searchProfiles}
          searchEmojis={searchEmojis}
          searchCommands={searchCommands}
          onCommandExecute={onCommandExecute}
          onChange={onEditorChange}
          onFilePaste={(files) => openUpload(files)}
          onSubmit={(content, emojiTags, blobAttachments) =>
            content.trim()
              ? onSend(content, replyToRef.current, emojiTags, blobAttachments)
              : undefined
          }
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 flex-shrink-0 px-2 text-xs"
          disabled={isSending}
          onClick={() => editorRef.current?.submit()}
        >
          {isSending ? <Loader2 className="size-3 animate-spin" /> : "Send"}
        </Button>
      </div>
      {uploadDialog}
    </div>
  );
}
