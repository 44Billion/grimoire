import { getKindInfo } from "@/constants/kinds";
import { cn } from "@/lib/utils";

interface KindBadgeProps {
  kind: number;
  showIcon?: boolean;
  showName?: boolean;
  showKindNumber?: boolean;
  variant?: "default" | "compact" | "full";
  className?: string;
  iconClassname?: string;
}

export function KindBadge({
  kind,
  showIcon: propShowIcon,
  showName: propShowName,
  showKindNumber: propShowKindNumber,
  variant = "default",
  className = "",
  iconClassname = "text-muted-foreground",
}: KindBadgeProps) {
  const kindInfo = getKindInfo(kind);
  const Icon = kindInfo?.icon;

  const style = "inline-flex items-center gap-2 text-foreground";

  // Apply variant presets or use props
  let showIcon = propShowIcon ?? true;
  let showName = propShowName ?? true;
  let showKindNumber = propShowKindNumber ?? false;

  if (variant === "compact") {
    showIcon = true;
    showName = false;
    showKindNumber = false;
  } else if (variant === "full") {
    showIcon = true;
    showName = true;
    showKindNumber = true;
  }

  if (!kindInfo) {
    return (
      <div className={cn(style, className)}>
        <span>Kind {kind}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(style, className)}
      title={`${kindInfo.description} (NIP-${kindInfo.nip})`}
    >
      {showIcon && Icon && <Icon className={cn("size-4", iconClassname)} />}
      {showName && <span>{kindInfo.name}</span>}
      {showKindNumber && <span>({kind})</span>}
    </div>
  );
}
