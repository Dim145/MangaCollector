import { describe, expect, it } from "vitest";
import {
  parseInline,
  parseMarkdown,
  slugify,
  tableOfContents,
} from "./markdown.js";

describe("parseInline", () => {
  it("splits emphasis, code and links out of the prose", () => {
    expect(
      parseInline("A **bold** and `code` and [a link](/aide) end"),
    ).toEqual([
      { type: "text", value: "A " },
      { type: "strong", value: "bold" },
      { type: "text", value: " and " },
      { type: "code", value: "code" },
      { type: "text", value: " and " },
      { type: "link", value: "a link", href: "/aide" },
      { type: "text", value: " end" },
    ]);
  });

  it("leaves plain prose in one piece", () => {
    expect(parseInline("nothing to see")).toEqual([
      { type: "text", value: "nothing to see" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, both kinds of list, quotes, code and rules", () => {
    const blocks = parseMarkdown(`# Title

Some prose
wrapped over two lines.

## A section

- first
- second
  continued

1. one
2. two

> quoted

\`\`\`bash
pnpm test
\`\`\`

---
`);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list",
      "list",
      "quote",
      "code",
      "rule",
    ]);
    expect(blocks[1].inline[0].value).toBe(
      "Some prose wrapped over two lines.",
    );
    expect(blocks[3].ordered).toBe(false);
    expect(blocks[3].items).toHaveLength(2);
    expect(blocks[3].items[1][0].value).toBe("second continued");
    expect(blocks[4].ordered).toBe(true);
    expect(blocks[6]).toEqual({
      type: "code",
      lang: "bash",
      value: "pnpm test",
    });
  });

  it("gives every heading a stable anchor and lists the second level", () => {
    const blocks = parseMarkdown("## Prêts & emprunts\n\n## Le scanneur\n");
    expect(blocks[0].id).toBe("prets-emprunts");
    expect(tableOfContents(blocks)).toEqual([
      { id: "prets-emprunts", value: "Prêts & emprunts" },
      { id: "le-scanneur", value: "Le scanneur" },
    ]);
  });

  it("copes with nothing", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(slugify("   ")).toBe("");
  });
});
