interface HashtagNodeProps {
  node: {
    hashtag: string;
  };
}

export function Hashtag({ node }: HashtagNodeProps) {
  return (
    <a
      href={`/t/${node.hashtag}`}
      className="text-muted-foreground hover:text-primary cursor-crosshair"
      onClick={(e) => e.preventDefault()}
    >
      #{node.hashtag}
    </a>
  );
}
