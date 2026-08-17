/**
 * The call, wherever you are.
 *
 * A call outlives the window that started it — that is the whole point of
 * keeping it out of React state — but until now nothing said so once you had
 * navigated away or switched workspaces. In a tiling window manager that is
 * worse than in a single-pane app: the call window can be on a desktop you are
 * not looking at, and a live microphone with no indicator is a privacy problem
 * rather than a UX one.
 *
 * So this lives in the tab bar, which is the only chrome every workspace shares.
 * It shows nothing at all when there is no call, and when there is one it offers
 * the two things worth reaching without navigating: the mute, and the way out.
 * Clicking the name goes to the call — switching workspaces if the window is on
 * another one.
 */

import { useAtomValue } from "jotai";
import { Loader2, Mic, MicOff, Phone, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { callStateAtom } from "@/services/concord-call-state";

/**
 * Acting on the call needs the service, which needs `livekit-client`. This bar
 * is in the app's first load, so the import waits for the click — by which time
 * the chunk is already in memory anyway, because a call is running.
 */
async function callService() {
  return import("@/services/concord-call");
}

export function CallPill() {
  const call = useAtomValue(callStateAtom);
  const { state, setActiveWorkspace } = useGrimoire();

  // A failed call is reported where the attempt was made; a pill that lingered
  // on an error would follow the reader around the whole app.
  if (call.status !== "connected" && call.status !== "joining") return null;

  const connected = call.status === "connected";
  const goToCall = () => {
    if (!call.windowId) return;
    const owner = Object.values(state.workspaces).find((ws) =>
      ws.windowIds.includes(call.windowId as string),
    );
    if (owner && owner.id !== state.activeWorkspaceId) {
      setActiveWorkspace(owner.id);
    }
  };

  return (
    <div className="flex flex-shrink-0 items-center gap-0.5 rounded border border-primary/40 bg-primary/10 px-1 py-0.5">
      <button
        type="button"
        onClick={goToCall}
        title="Go to the call"
        className="flex items-center gap-1 rounded px-1 text-xs leading-none hover:bg-muted"
      >
        {connected ? (
          <Phone className="size-3 shrink-0 text-primary" />
        ) : (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        )}
        <span className="max-w-24 truncate">{call.channelName ?? "Call"}</span>
        {connected && call.fold.present.length > 0 && (
          <span className="tabular-nums text-muted-foreground">
            {call.fold.present.length}
          </span>
        )}
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="size-5"
        disabled={!connected}
        title={call.micEnabled ? "Mute" : "Unmute"}
        onClick={() =>
          void callService().then((s) => s.setMicEnabled(!call.micEnabled))
        }
      >
        {call.micEnabled ? (
          <Mic className={cn("size-3", "text-primary")} />
        ) : (
          <MicOff className="size-3" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-5 text-destructive"
        title="Leave the call"
        onClick={() => void callService().then((s) => s.leaveCall())}
      >
        <PhoneOff className="size-3" />
      </Button>
    </div>
  );
}
