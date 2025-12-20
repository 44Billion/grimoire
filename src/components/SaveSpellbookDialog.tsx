import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { useGrimoire } from "@/core/state";
import { toast } from "sonner";
import { saveSpellbook } from "@/services/spellbook-storage";
import { PublishSpellbookAction } from "@/actions/publish-spellbook";
import { createSpellbook } from "@/lib/spellbook-manager";
import { Loader2, Save, Send } from "lucide-react";

interface SaveSpellbookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaveSpellbookDialog({
  open,
  onOpenChange,
}: SaveSpellbookDialogProps) {
  const { state } = useGrimoire();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>(
    Object.keys(state.workspaces),
  );
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (shouldPublish: boolean) => {
    if (!title.trim()) {
      toast.error("Please enter a title for your spellbook");
      return;
    }

    if (selectedWorkspaces.length === 0) {
      toast.error("Please select at least one workspace to include");
      return;
    }

    setIsSaving(true);
    if (shouldPublish) setIsPublishing(true);

    try {
      // 1. Create content
      const encoded = createSpellbook({
        state,
        title,
        description,
        workspaceIds: selectedWorkspaces,
      });

      // 2. Save locally
      const localSpellbook = await saveSpellbook({
        slug: title.toLowerCase().trim().replace(/\s+/g, "-"),
        title,
        description,
        content: JSON.parse(encoded.eventProps.content),
        isPublished: false,
      });

      // 3. Optionally publish
      if (shouldPublish) {
        const action = new PublishSpellbookAction();
        await action.execute({
          state,
          title,
          description,
          workspaceIds: selectedWorkspaces,
          localId: localSpellbook.id,
        });
        toast.success("Spellbook saved and published to Nostr");
      } else {
        toast.success("Spellbook saved locally");
      }

      onOpenChange(false);
      // Reset form
      setTitle("");
      setDescription("");
    } catch (error) {
      console.error("Failed to save spellbook:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save spellbook");
    } finally {
      setIsSaving(false);
      setIsPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Save Layout as Spellbook</DialogTitle>
          <DialogDescription>
            Save your current workspaces and window configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Title</Label>
            <Input
              id="title"
              placeholder="e.g. My Daily Dashboard"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="What is this layout for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid gap-2">
            <Label>Workspaces to include</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {Object.values(state.workspaces)
                .sort((a, b) => a.number - b.number)
                .map((ws) => (
                  <div key={ws.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`ws-${ws.id}`}
                      checked={selectedWorkspaces.includes(ws.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedWorkspaces([...selectedWorkspaces, ws.id]);
                        } else {
                          setSelectedWorkspaces(
                            selectedWorkspaces.filter((id) => id !== ws.id),
                          );
                        }
                      }}
                    />
                    <label
                      htmlFor={`ws-${ws.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {ws.number}. {ws.label || "Workspace"}
                    </label>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => handleSave(false)}
            disabled={isSaving}
          >
            {isSaving && !isPublishing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Locally
          </Button>
          <Button onClick={() => handleSave(true)} disabled={isSaving}>
            {isPublishing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Save & Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
