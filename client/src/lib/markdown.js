/**
 * 記 · A small Markdown reader for the app's own prose.
 *
 * Not a general-purpose parser: it reads the subset the help pages are
 * written in, and it parses to plain objects rather than HTML, so the
 * renderer builds React elements and nothing is ever injected. The
 * input is a file we ship, not user text — but producing data instead
 * of markup means that stays true even if that ever changes.
 *
 * Blocks: heading, paragraph, list (ordered or not), quote, code, rule.
 * Inline: **strong**, *em*, `code`, [text](href).
 */

/** Slug for a heading, so a section can be linked to. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const INLINE = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))/g;

/** One line of prose as a list of tokens. */
export function parseInline(text) {
  const out = [];
  let last = 0;
  const push = (token) => {
    if (token.type === "text" && token.value === "") return;
    out.push(token);
  };
  for (const m of String(text).matchAll(INLINE)) {
    push({ type: "text", value: text.slice(last, m.index) });
    const [raw] = m;
    if (raw.startsWith("**")) push({ type: "strong", value: raw.slice(2, -2) });
    else if (raw.startsWith("`"))
      push({ type: "code", value: raw.slice(1, -1) });
    else if (raw.startsWith("[")) {
      const cut = raw.indexOf("](");
      push({
        type: "link",
        value: raw.slice(1, cut),
        href: raw.slice(cut + 2, -1),
      });
    } else push({ type: "em", value: raw.slice(1, -1) });
    last = m.index + raw.length;
  }
  push({ type: "text", value: text.slice(last) });
  return out;
}

/** The document as a list of blocks. */
export function parseMarkdown(source) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (!buf.length) return;
    blocks.push({ type: "paragraph", inline: parseInline(buf.join(" ")) });
    buf.length = 0;
  };

  const paragraph = [];
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph(paragraph);
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushParagraph(paragraph);
      const lang = trimmed.slice(3).trim() || null;
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ type: "code", lang, value: body.join("\n") });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(paragraph);
      const value = heading[2].trim();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        value,
        id: slugify(value),
        inline: parseInline(value),
      });
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph(paragraph);
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushParagraph(paragraph);
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        body.push(lines[i].trim().slice(2));
        i += 1;
      }
      blocks.push({ type: "quote", inline: parseInline(body.join(" ")) });
      continue;
    }

    const bullet = /^([-*]|\d+\.)\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph(paragraph);
      const ordered = /\d/.test(bullet[1]);
      const items = [];
      while (i < lines.length) {
        const m = /^([-*]|\d+\.)\s+(.*)$/.exec(lines[i].trim());
        if (!m || /\d/.test(m[1]) !== ordered) break;
        const parts = [m[2]];
        i += 1;
        // a wrapped item continues on an indented line
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          parts.push(lines[i].trim());
          i += 1;
        }
        items.push(parseInline(parts.join(" ")));
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }
  flushParagraph(paragraph);
  return blocks;
}

/** The `##` headings, for a table of contents. */
export function tableOfContents(blocks) {
  return blocks
    .filter((b) => b.type === "heading" && b.level === 2)
    .map((b) => ({ id: b.id, value: b.value }));
}
