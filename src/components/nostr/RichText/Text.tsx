import { CommonData } from "applesauce-content/nast";

interface TextNodeProps {
  node: {
    type: "text";
    value: string;
    data?: CommonData;
  };
}

// Newlines and runs of spaces are preserved by `whitespace-pre-wrap` on the
// RichText container, so the raw value can be rendered as-is.
export function Text({ node }: TextNodeProps) {
  return <span dir="auto">{node.value}</span>;
}
