import { CommonData } from "applesauce-content/nast";
import { useMemo } from "react";

interface TextNodeProps {
  node: {
    type: "text";
    value: string;
    data?: CommonData;
  };
}

export function Text({ node }: TextNodeProps) {
  const text = node.value;
  const lines = useMemo(() => text.split("\n"), [text]);
  if (text.includes("\n")) {
    return (
      <>
        {lines.map((line, idx) =>
          line.trim().length === 0 ? (
            <br />
          ) : idx === 0 || idx === lines.length - 1 ? (
            <span dir="auto">{line}</span> // FIXME: this should be span or div depnding on context
          ) : (
            <div dir="auto" key={idx}>
              {line}
            </div>
          ),
        )}
      </>
    );
  }
  return <span dir="auto">{text}</span>;
}
