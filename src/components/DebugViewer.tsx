import { useGrimoire } from "@/core/state";
import { useCopy } from "@/hooks/useCopy";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import { CodeCopyButton } from "@/components/CodeCopyButton";

export function DebugViewer() {
  const { state } = useGrimoire();
  const { copy, copied } = useCopy();

  const stateJson = JSON.stringify(state, null, 2);

  const handleCopy = () => {
    copy(stateJson);
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">Application State</h2>
      </div>
      <div className="flex-1 overflow-auto relative">
        <SyntaxHighlight
          code={stateJson}
          language="json"
          className="bg-muted p-4"
        />
        <CodeCopyButton
          onCopy={handleCopy}
          copied={copied}
          label="Copy state"
        />
      </div>
    </div>
  );
}
