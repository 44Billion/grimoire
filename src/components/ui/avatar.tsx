import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";
import { getEmojiMaskUrl, isValidAvatarShape } from "@/lib/avatar-shape";

/** So AvatarFallback can drop its own `rounded-full` when a shape is set. */
const AvatarShapeContext = React.createContext<string | undefined>(undefined);

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
    /** Emoji whose silhouette masks the avatar. Defaults to a circle. */
    shape?: string;
  }
>(({ className, shape, style, ...props }, ref) => {
  // Synchronous so there's no flash of an unmasked square; the data-URL is
  // cached after the first render of a given emoji.
  const maskUrl =
    shape && isValidAvatarShape(shape) ? getEmojiMaskUrl(shape) : "";

  const maskedStyle = React.useMemo<React.CSSProperties>(
    () =>
      maskUrl
        ? {
            ...style,
            WebkitMaskImage: `url(${maskUrl})`,
            maskImage: `url(${maskUrl})`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }
        : (style ?? {}),
    [maskUrl, style],
  );

  return (
    <AvatarShapeContext.Provider value={maskUrl ? shape : undefined}>
      <AvatarPrimitive.Root
        ref={ref}
        className={cn(
          "relative flex h-10 w-10 shrink-0 overflow-hidden",
          !maskUrl && "rounded-full",
          className,
        )}
        style={maskedStyle}
        {...props}
      />
    </AvatarShapeContext.Provider>
  );
});
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => {
  const shape = React.useContext(AvatarShapeContext);
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        "flex h-full w-full items-center justify-center bg-muted",
        !shape && "rounded-full",
        className,
      )}
      {...props}
    />
  );
});
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };
