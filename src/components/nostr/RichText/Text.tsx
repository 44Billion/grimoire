interface TextNodeProps {
  node: {
    value: string;
  };
}

export function Text({ node }: TextNodeProps) {
  return <>{node.value}</>;
}
