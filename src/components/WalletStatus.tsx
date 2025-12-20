import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import walletService from "@/services/wallet";
import { Button } from "./ui/button";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function WalletStatus() {
  const [status, setStatus] = useState(walletService.status$.value);
  const { addWindow } = useGrimoire();

  useEffect(() => {
    const sub = walletService.status$.subscribe(setStatus);
    return () => sub.unsubscribe();
  }, []);

  const handleClick = () => {
    addWindow("wallet", {});
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleClick}
          aria-label="Wallet status"
        >
          <Wallet
            className={cn(
              "h-3 w-3 transition-colors",
              status === "connected" ? "text-green-500" : "text-muted-foreground",
              status === "connecting" && "animate-pulse text-yellow-500"
            )}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">
          Wallet: {status.charAt(0).toUpperCase() + status.slice(1)}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
