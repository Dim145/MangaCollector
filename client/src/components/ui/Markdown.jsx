import { Link } from "react-router-dom";

/**
 * 記 · Renders the block list `parseMarkdown` produces as React
 * elements. Nothing is ever set as HTML — the parser hands out data and
 * this turns it into nodes, so the page cannot be made to inject.
 */

function Inline({ tokens }) {
  return tokens.map((token, i) => {
    switch (token.type) {
      case "strong":
        return (
          <strong key={i} className="font-semibold text-washi">
            {token.value}
          </strong>
        );
      case "em":
        return (
          <em key={i} className="italic">
            {token.value}
          </em>
        );
      case "code":
        return (
          <code
            key={i}
            className="rounded-sm bg-ink-2/80 px-1 py-0.5 font-mono text-[0.85em] text-gold"
          >
            {token.value}
          </code>
        );
      case "link": {
        // 印 · The parser accepts any `[text](href)`, and React Router
        // renders an absolute href verbatim — it is React's own URL
        // sanitiser that currently stops `javascript:`. Relying on the
        // framework for that is one upgrade away from being wrong, so
        // the scheme is checked here: http(s) leaves the app, a path
        // stays inside it, anything else is rendered as plain text.
        const href = String(token.href ?? "");
        const external = /^https?:\/\//i.test(href);
        const internal = /^\/(?!\/)/.test(href) || /^#/.test(href);
        if (!external && !internal) {
          return <span key={i}>{token.value}</span>;
        }
        const className =
          "text-gold underline-offset-4 hover:underline focus-visible:underline";
        return external ? (
          <a
            key={i}
            href={token.href}
            target="_blank"
            rel="noreferrer noopener"
            className={className}
          >
            {token.value}
          </a>
        ) : (
          <Link key={i} to={token.href} className={className}>
            {token.value}
          </Link>
        );
      }
      default:
        return <span key={i}>{token.value}</span>;
    }
  });
}

export default function Markdown({ blocks }) {
  return (
    <div className="space-y-5">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading": {
            if (block.level === 1) return null; // the page carries its own title
            const Tag = block.level === 2 ? "h2" : "h3";
            return (
              <Tag
                key={i}
                id={block.id}
                className={
                  block.level === 2
                    ? "scroll-mt-24 pt-6 font-display text-2xl font-light italic text-washi"
                    : "scroll-mt-24 pt-2 font-display text-lg italic text-washi-muted"
                }
              >
                <Inline tokens={block.inline} />
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={i} className="leading-relaxed text-washi-muted">
                <Inline tokens={block.inline} />
              </p>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag
                key={i}
                className={`space-y-2 pl-5 text-washi-muted ${
                  block.ordered ? "list-decimal" : "list-disc"
                } marker:text-hanko-bright`}
              >
                {block.items.map((tokens, j) => (
                  <li key={j} className="leading-relaxed">
                    <Inline tokens={tokens} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote
                key={i}
                className="border-l-2 border-gold/60 pl-4 font-display text-lg font-light italic text-washi-muted"
              >
                <Inline tokens={block.inline} />
              </blockquote>
            );
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-md border border-border bg-ink-0/60 p-4 font-mono text-xs text-washi-muted"
              >
                <code>{block.value}</code>
              </pre>
            );
          case "rule":
            return <hr key={i} className="border-border/60" />;
          default:
            return null;
        }
      })}
    </div>
  );
}
