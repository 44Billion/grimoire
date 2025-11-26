import { useMemo } from "react";

export default function Timestamp({ timestamp }: { timestamp: number }) {
  const formatted = useMemo(() => {
    const intl = new Intl.DateTimeFormat("es", {
      timeStyle: "short",
    });
    return intl.format(timestamp * 1000);
  }, [timestamp]);
  return formatted;
}
