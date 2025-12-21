import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { GitCommit } from "lucide-react";
import {
  getRepositoryIdentifier,
  getRepositoryStateHeadCommit,
  parseHeadBranch,
  getRepositoryStateHead,
} from "@/lib/nip34-helpers";

/**
 * Renderer for Kind 30618 - Repository State
 * Displays as a compact git push notification in feed view
 */
export function RepositoryStateRenderer({ event }: BaseEventProps) {
  const repoId = getRepositoryIdentifier(event);
  const headRef = getRepositoryStateHead(event);
  const branch = parseHeadBranch(headRef);
  const commitHash = getRepositoryStateHeadCommit(event);

  // Format: "pushed <8 chars of HEAD commit> to <branch> in <repo>"
  const shortHash = commitHash?.substring(0, 8) || "unknown";
  const branchName = branch || "unknown";
  const repoName = repoId || "repository";

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Push notification */}
        <div className="flex items-center gap-2">
          <GitCommit className="size-4 text-muted-foreground flex-shrink-0" />
          <ClickableEventTitle
            event={event}
            className="text-sm font-medium text-foreground"
            as="span"
          >
            pushed{" "}
            <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
              {shortHash}
            </code>{" "}
            to <span className="font-semibold">{branchName}</span> in{" "}
            <span className="font-semibold">{repoName}</span>
          </ClickableEventTitle>
        </div>
      </div>
    </BaseEventContainer>
  );
}
