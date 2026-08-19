"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
import { useCallback } from "react";

export type SuggestionsProps = ComponentProps<"div">;

/**
 * Local: upstream is a horizontal ScrollArea. grimoire windows are a tile of a
 * split layout, so a row that scrolls sideways hides every opener past the
 * second one behind a scrollbar it also hides. They wrap instead.
 */
export const Suggestions = ({
  className,
  children,
  ...props
}: SuggestionsProps) => (
  <div
    className={cn("flex w-full flex-wrap items-center gap-2", className)}
    {...props}
  >
    {children}
  </div>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = "outline",
  size = "sm",
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = useCallback(() => {
    onClick?.(suggestion);
  }, [onClick, suggestion]);

  return (
    <Button
      className={cn(
        // `h-auto` and normal wrapping: an opener is a sentence, and a narrow
        // window would otherwise clip it mid-word.
        "h-auto cursor-pointer whitespace-normal rounded-full px-4 py-1 text-left",
        className,
      )}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children || suggestion}
    </Button>
  );
};
