import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * 札 · Label sheets. The geometry, EAN-13 and label builders are pure
 * and tested directly; `buildLabelPdf` is exercised against mocked
 * `jspdf` / `jsbarcode` modules and a stubbed canvas (jsdom has no 2D
 * context) to pin the call sequence — positions, page breaks, which
 * labels get a barcode — and the fact that both libraries are loaded
 * lazily, on the first build, never at import time.
 */

const spies = vi.hoisted(() => ({
  jspdfLoaded: vi.fn(),
  jsbarcodeLoaded: vi.fn(),
  ctor: vi.fn(),
  addImage: vi.fn(),
  addPage: vi.fn(),
  output: vi.fn(),
  barcode: vi.fn(),
}));

vi.mock("jspdf", () => {
  spies.jspdfLoaded();
  class FakeJsPdf {
    constructor(options) {
      spies.ctor(options);
    }
    setProperties() {}
    addPage() {
      spies.addPage();
    }
    addImage(...args) {
      spies.addImage(...args);
    }
    output(kind) {
      spies.output(kind);
      return new Blob(["%PDF-1.4"], { type: "application/pdf" });
    }
  }
  return { jsPDF: FakeJsPdf };
});

vi.mock("jsbarcode", () => {
  spies.jsbarcodeLoaded();
  return {
    default: (canvas, value, options) => {
      spies.barcode(value, options);
      canvas.width = 95 * options.width + options.fontSize;
      canvas.height = options.height + options.fontSize + options.textMargin;
    },
  };
});

import {
  BOX_LABEL_MAX_LINES,
  DEFAULT_TEMPLATE_ID,
  LABEL_TEMPLATES,
  PAGE_SIZES,
  boxLabel,
  buildLabelPdf,
  ean13Of,
  ellipsize,
  isEan13,
  layoutSheet,
  pageCount,
  pageOf,
  perPage,
  planLabel,
  sheetOccupancy,
  slotOf,
  summarizeLabels,
  tomeLabels,
  tomeLine,
  truncate,
  wrapText,
} from "./labels.js";

const templates = Object.values(LABEL_TEMPLATES);
const L7160 = LABEL_TEMPLATES["avery-l7160"];

describe("LABEL_TEMPLATES geometry", () => {
  it("ships the five presets on their page sizes", () => {
    expect(templates.map((t) => t.id)).toEqual([
      "avery-l7160",
      "avery-l7163",
      "avery-l7651",
      "avery-5160",
      "avery-5163",
    ]);
    expect(LABEL_TEMPLATES[DEFAULT_TEMPLATE_ID]).toBe(L7160);
    expect(templates.map((t) => t.page)).toEqual([
      "a4",
      "a4",
      "a4",
      "letter",
      "letter",
    ]);
  });

  it.each(templates)("$id: the grid fits its page and is centred", (t) => {
    const page = PAGE_SIZES[t.page];
    const gridW = t.cols * t.labelW + (t.cols - 1) * t.gapX;
    const gridH = t.rows * t.labelH + (t.rows - 1) * t.gapY;
    const right = page.w - t.marginLeft - gridW;
    const bottom = page.h - t.marginTop - gridH;
    expect(right).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeGreaterThanOrEqual(0);
    // Avery layouts are symmetric — a drift here means a typo above.
    expect(Math.abs(right - t.marginLeft)).toBeLessThan(0.15);
    expect(Math.abs(bottom - t.marginTop)).toBeLessThan(0.15);
  });

  it("uses the published label counts", () => {
    expect(perPage(LABEL_TEMPLATES["avery-l7160"])).toBe(21);
    expect(perPage(LABEL_TEMPLATES["avery-l7163"])).toBe(14);
    expect(perPage(LABEL_TEMPLATES["avery-l7651"])).toBe(65);
    expect(perPage(LABEL_TEMPLATES["avery-5160"])).toBe(30);
    expect(perPage(LABEL_TEMPLATES["avery-5163"])).toBe(10);
  });
});

describe("layoutSheet", () => {
  it.each(templates)("$id: one position per label, row-major", (t) => {
    const positions = layoutSheet(t);
    expect(positions).toHaveLength(t.cols * t.rows);
    expect(positions[0]).toEqual({ x: t.marginLeft, y: t.marginTop });
    // Second label sits one pitch to the right, first of row two one
    // pitch down.
    expect(positions[1].x).toBeCloseTo(t.marginLeft + t.labelW + t.gapX, 6);
    expect(positions[1].y).toBeCloseTo(t.marginTop, 6);
    expect(positions[t.cols].x).toBeCloseTo(t.marginLeft, 6);
    expect(positions[t.cols].y).toBeCloseTo(t.marginTop + t.labelH + t.gapY, 6);
  });

  it("keeps every label inside the page", () => {
    for (const t of templates) {
      const page = PAGE_SIZES[t.page];
      for (const { x, y } of layoutSheet(t)) {
        expect(x + t.labelW).toBeLessThanOrEqual(page.w + 1e-9);
        expect(y + t.labelH).toBeLessThanOrEqual(page.h + 1e-9);
      }
    }
  });
});

describe("page arithmetic", () => {
  it("maps running indices to sheets and slots", () => {
    expect(pageOf(0, L7160)).toBe(0);
    expect(pageOf(20, L7160)).toBe(0);
    expect(pageOf(21, L7160)).toBe(1);
    expect(slotOf(21, L7160)).toBe(0);
    expect(slotOf(25, L7160)).toBe(4);
  });

  it("counts sheets, honouring a start offset", () => {
    expect(pageCount(0, L7160)).toBe(0);
    expect(pageCount(21, L7160)).toBe(1);
    expect(pageCount(22, L7160)).toBe(2);
    expect(pageCount(20, L7160, 1)).toBe(1);
    expect(pageCount(20, L7160, 2)).toBe(2);
  });

  it("describes each cell of a sheet for the preview", () => {
    const first = sheetOccupancy(3, L7160, 2);
    expect(first).toHaveLength(21);
    expect(first.slice(0, 6)).toEqual([
      "skipped",
      "skipped",
      "used",
      "used",
      "used",
      "free",
    ]);
    // 25 labels from slot 20: one on sheet 1, then 21 filling sheet 2,
    // then 3 on sheet 3.
    expect(
      sheetOccupancy(25, L7160, 20).filter((c) => c === "used"),
    ).toHaveLength(1);
    expect(sheetOccupancy(25, L7160, 20, 1).every((c) => c === "used")).toBe(
      true,
    );
    expect(
      sheetOccupancy(25, L7160, 20, 2).filter((c) => c === "used"),
    ).toHaveLength(3);
  });

  it("summarises count, sheets and text-only labels", () => {
    const labels = [
      { title: "A", barcode: "9780306406157" },
      { title: "B", barcode: null },
      { title: "C", barcode: "not-a-code" },
    ];
    expect(summarizeLabels(labels, L7160)).toEqual({
      count: 3,
      pages: 1,
      withoutBarcode: 2,
    });
    expect(summarizeLabels(labels, L7160, 20).pages).toBe(2);
    expect(summarizeLabels(undefined, L7160)).toEqual({
      count: 0,
      pages: 0,
      withoutBarcode: 0,
    });
  });
});

describe("isEan13 / ean13Of", () => {
  it("accepts valid EAN-13s, ISBN-13s included, separators ignored", () => {
    expect(isEan13("9780306406157")).toBe(true);
    expect(isEan13("978-0-306-40615-7")).toBe(true);
    expect(isEan13("4006381333931")).toBe(true);
    expect(isEan13("9784088725093")).toBe(true);
  });

  it("rejects a wrong check digit, wrong length or non-digits", () => {
    expect(isEan13("9780306406158")).toBe(false);
    expect(isEan13("978030640615")).toBe(false);
    expect(isEan13("97803064061570")).toBe(false);
    expect(isEan13("978030640615X")).toBe(false);
    expect(isEan13("")).toBe(false);
    expect(isEan13(null)).toBe(false);
    expect(isEan13(undefined)).toBe(false);
  });

  it("normalises ISBN-10s to the 978 barcode and refuses broken ones", () => {
    expect(ean13Of("0-8044-2957-X")).toBe("9780804429573");
    expect(ean13Of("0306406152")).toBe("9780306406157");
    expect(ean13Of("978-0-306-40615-7")).toBe("9780306406157");
    expect(ean13Of("0306406153")).toBeNull();
    expect(ean13Of("9780306406158")).toBeNull();
    expect(ean13Of("hello")).toBeNull();
    expect(ean13Of(null)).toBeNull();
  });
});

describe("tomeLabels", () => {
  const series = { mal_id: 13, name: "One Piece" };
  const volumes = [
    { id: 3, mal_id: 13, vol_num: 3 },
    { id: 1, mal_id: 13, vol_num: 1, isbn: "9780306406157" },
    { id: 2, mal_id: 13, vol_num: 2, release_isbn: "0-8044-2957-X" },
    // Broken copy ISBN, valid announced one: the announced code wins.
    {
      id: 4,
      mal_id: 13,
      vol_num: 4,
      isbn: "9780306406158",
      release_isbn: "9784088725093",
    },
    // Both present and valid: the copy's own ISBN wins.
    {
      id: 5,
      mal_id: 13,
      vol_num: 5,
      isbn: "4006381333931",
      release_isbn: "9784088725093",
    },
  ];

  it("builds one label per tome, sorted, with the barcode fallback chain", () => {
    const labels = tomeLabels(series, volumes);
    expect(labels.map((l) => l.line2)).toEqual([
      "T.1",
      "T.2",
      "T.3",
      "T.4",
      "T.5",
    ]);
    expect(labels.every((l) => l.title === "One Piece")).toBe(true);
    expect(labels.map((l) => l.barcode)).toEqual([
      "9780306406157",
      "9780804429573",
      null,
      "9784088725093",
      "4006381333931",
    ]);
    expect(labels[0]).toEqual({
      title: "One Piece",
      line2: "T.1",
      line3: null,
      barcode: "9780306406157",
    });
  });

  it("takes the caller's tome word and third line", () => {
    const [first] = tomeLabels(series, [volumes[1]], {
      tomeWord: "Tome",
      line3: "Glénat",
    });
    expect(first.line2).toBe("Tome 1");
    expect(first.line3).toBe("Glénat");

    const withFn = tomeLabels(
      series,
      [
        { vol_num: 7, location: "Shelf B" },
        { vol_num: 8, location: "   " },
      ],
      { tomeWord: "Vol.", line3: (v) => v.location },
    );
    expect(withFn.map((l) => l.line2)).toEqual(["Vol.7", "Vol.8"]);
    expect(withFn.map((l) => l.line3)).toEqual(["Shelf B", null]);
  });

  it("tolerates missing input and skips tomes without a number", () => {
    expect(tomeLabels(undefined, undefined)).toEqual([]);
    expect(
      tomeLabels({ title: "Berserk" }, [{ vol_num: null }, { vol_num: "2" }]),
    ).toEqual([{ title: "Berserk", line2: "T.2", line3: null, barcode: null }]);
  });

  it("glues punctuation words, spaces plain words, fills {n}", () => {
    expect(tomeLine(12)).toBe("T.12");
    expect(tomeLine(12, "Vol.")).toBe("Vol.12");
    expect(tomeLine(12, "#")).toBe("#12");
    expect(tomeLine(12, "Tome")).toBe("Tome 12");
    expect(tomeLine(12, "第{n}巻")).toBe("第12巻");
    expect(tomeLine(12, "")).toBe("12");
  });
});

describe("boxLabel", () => {
  const lines = Array.from({ length: 12 }, (_, i) => `Series ${i + 1}`);

  it("keeps short listings as they are", () => {
    expect(boxLabel("Box A", ["One Piece", "Berserk"])).toEqual({
      title: "Box A",
      lines: ["One Piece", "Berserk"],
    });
    expect(
      boxLabel("Box B", lines.slice(0, BOX_LABEL_MAX_LINES)).lines,
    ).toHaveLength(BOX_LABEL_MAX_LINES);
  });

  it("caps at eight lines, the last one counting the rest", () => {
    const { lines: out } = boxLabel("Box C", lines);
    expect(out).toHaveLength(8);
    expect(out.slice(0, 7)).toEqual(lines.slice(0, 7));
    expect(out[7]).toBe("+5 more");
    expect(
      boxLabel("Box C", lines, { moreLabel: "+{n} autres" }).lines[7],
    ).toBe("+5 autres");
    expect(boxLabel("Box D", lines, { maxLines: 3 }).lines).toEqual([
      "Series 1",
      "Series 2",
      "+10 more",
    ]);
  });

  it("drops blanks and cuts long lines with an ellipsis", () => {
    const long =
      "The Seven Deadly Sins: Four Knights of the Apocalypse Omnibus";
    const { lines: out } = boxLabel("  Box E ", [null, "", "  Berserk ", long]);
    expect(out[0]).toBe("Berserk");
    expect(out[1].endsWith("…")).toBe(true);
    expect(Array.from(out[1]).length).toBeLessThanOrEqual(40);
    expect(boxLabel("Box E", [long], { maxChars: 10 }).lines[0]).toBe(
      "The Seven…",
    );
    expect(truncate("鋼の錬金術師", 4)).toBe("鋼の錬…");
    expect(truncate("short", 10)).toBe("short");
  });
});

describe("text fitting with a fake ruler", () => {
  // One unit per code point — widths are simply lengths.
  const measure = (s) => Array.from(s).length;

  it("ellipsizes to the available width", () => {
    expect(ellipsize("One Piece", 20, measure)).toBe("One Piece");
    expect(ellipsize("Fullmetal Alchemist", 10, measure)).toBe("Fullmetal…");
    expect(ellipsize("Berserk", 1, measure)).toBe("…");
  });

  it("wraps on words, breaks kanji runs, cuts the last line", () => {
    expect(wrapText("One Piece", 10, measure)).toEqual(["One Piece"]);
    expect(wrapText("Fullmetal Alchemist Brotherhood", 10, measure)).toEqual([
      "Fullmetal",
      "Alchemist…",
    ]);
    expect(wrapText("Jojo's Bizarre Adventure", 12, measure, 3)).toEqual([
      "Jojo's",
      "Bizarre",
      "Adventure",
    ]);
    expect(wrapText("鋼の錬金術師ハガレン完全版", 10, measure)).toEqual([
      "鋼の錬金術師ハガレン",
      "完全版",
    ]);
    expect(wrapText("   ", 10, measure)).toEqual([]);
  });
});

describe("planLabel", () => {
  // Rough proportional ruler: 0.55 em per character.
  const measure = (text, weight, size) => Array.from(text).length * size * 0.55;

  it("reserves the bottom band for a valid barcode only", () => {
    const withCode = planLabel(
      { title: "One Piece", line2: "T.12", barcode: "9780306406157" },
      L7160,
      measure,
    );
    expect(withCode.barcode).toBe("9780306406157");
    expect(withCode.barcodeH).toBeGreaterThanOrEqual(7);
    expect(withCode.total).toBeLessThanOrEqual(withCode.textH);
    expect(withCode.titleLines).toEqual(["One Piece"]);
    expect(withCode.subLine).toBe("T.12");

    const textOnly = planLabel(
      { title: "One Piece", line2: "T.12" },
      L7160,
      measure,
    );
    expect(textOnly.barcode).toBeNull();
    expect(textOnly.barcodeH).toBe(0);
    expect(textOnly.textH).toBeGreaterThan(withCode.textH);
    expect(textOnly.textH).toBeCloseTo(L7160.labelH - 2 * textOnly.pad, 6);
  });

  it("wraps long titles to two lines and shrinks until the block fits", () => {
    const plan = planLabel(
      {
        title:
          "JoJo's Bizarre Adventure Part 7: Steel Ball Run — Deluxe Hardcover",
        line2: "T.3",
        line3: "Édition collector · Étagère B",
        barcode: "9784088725093",
      },
      LABEL_TEMPLATES["avery-l7651"],
      measure,
    );
    expect(plan.titleLines.length).toBeLessThanOrEqual(2);
    expect(plan.titleLines.at(-1).endsWith("…")).toBe(true);
    expect(plan.total).toBeLessThanOrEqual(plan.textH + 1e-9);
    expect(plan.titleSize).toBeGreaterThan(0);
  });

  it("sheds box lines it cannot fit and marks the cut", () => {
    // Fourteen lines can never fit a 21 mm spine label, even at the
    // smallest size — the planner must cut and say so.
    const box = boxLabel(
      "Box 3",
      Array.from({ length: 14 }, (_, i) => `Series ${i + 1}`),
      { maxLines: 14 },
    );
    expect(box.lines).toHaveLength(14);
    const plan = planLabel(box, LABEL_TEMPLATES["avery-l7651"], measure);
    expect(plan.metaLines.length).toBeLessThan(14);
    expect(plan.metaLines.at(-1).endsWith("…")).toBe(true);
    expect(plan.total).toBeLessThanOrEqual(plan.textH + 1e-9);
  });
});

describe("buildLabelPdf", () => {
  function stubCanvas() {
    const ctx = {
      font: "",
      fillStyle: "",
      textAlign: "",
      textBaseline: "",
      fillRect: vi.fn(),
      fillText: vi.fn(),
      drawImage: vi.fn(),
      measureText(text) {
        const px = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
        const size = px ? Number(px[1]) : 16;
        return { width: Array.from(text).length * size * 0.55 };
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ctx,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    return ctx;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not touch jspdf / jsbarcode until a sheet is built, then lays labels out", async () => {
    expect(spies.jspdfLoaded).not.toHaveBeenCalled();
    expect(spies.jsbarcodeLoaded).not.toHaveBeenCalled();

    const ctx = stubCanvas();
    const labels = [
      { title: "One Piece", line2: "T.1", barcode: "9780306406157" },
      { title: "One Piece", line2: "T.2", barcode: null },
      {
        title: "Berserk",
        line2: "T.3",
        line3: "Glénat",
        barcode: "9784088725093",
      },
    ];
    const blob = await buildLabelPdf(labels, {
      template: "avery-l7160",
      startAt: 2,
    });

    expect(spies.jspdfLoaded).toHaveBeenCalledTimes(1);
    expect(spies.jsbarcodeLoaded).toHaveBeenCalledTimes(1);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/pdf");
    expect(spies.output).toHaveBeenCalledWith("blob");
    expect(spies.ctor).toHaveBeenCalledWith(
      expect.objectContaining({ unit: "mm", format: "a4" }),
    );

    // Three stickers from slot 2 of the first sheet, none on a new page.
    const positions = layoutSheet(L7160);
    expect(spies.addPage).not.toHaveBeenCalled();
    expect(spies.addImage).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const [data, format, x, y, w, h] = spies.addImage.mock.calls[i];
      expect(data.startsWith("data:image/png")).toBe(true);
      expect(format).toBe("PNG");
      expect(x).toBeCloseTo(positions[2 + i].x, 6);
      expect(y).toBeCloseTo(positions[2 + i].y, 6);
      expect(w).toBe(L7160.labelW);
      expect(h).toBe(L7160.labelH);
    }

    // Only the two labels with a code went through the encoder.
    expect(spies.barcode).toHaveBeenCalledTimes(2);
    expect(spies.barcode.mock.calls.map((c) => c[0])).toEqual([
      "9780306406157",
      "9784088725093",
    ]);
    expect(spies.barcode.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        format: "EAN13",
        displayValue: true,
        margin: 0,
      }),
    );
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    // Every label paints its white ground and its text.
    expect(ctx.fillRect).toHaveBeenCalledTimes(3);
    expect(ctx.fillText.mock.calls.some(([text]) => text === "Glénat")).toBe(
      true,
    );
  });

  it("adds pages as the grid overflows and reports progress", async () => {
    stubCanvas();
    const seen = [];
    const labels = Array.from({ length: 23 }, (_, i) => ({
      title: "Berserk",
      line2: `T.${i + 1}`,
    }));
    await buildLabelPdf(labels, {
      template: L7160,
      startAt: 20,
      onProgress: (done, total) => seen.push([done, total]),
    });
    // Slot 20 fills sheet 1; 21 more fill sheet 2; one lands on sheet 3.
    expect(spies.addPage).toHaveBeenCalledTimes(2);
    expect(spies.addImage).toHaveBeenCalledTimes(23);
    expect(seen[0]).toEqual([1, 23]);
    expect(seen.at(-1)).toEqual([23, 23]);
    expect(spies.barcode).not.toHaveBeenCalled();
  });

  it("falls back to the default template and rejects unknown ids", async () => {
    stubCanvas();
    await buildLabelPdf([{ title: "Berserk", line2: "T.1" }], {});
    expect(spies.ctor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        format: LABEL_TEMPLATES[DEFAULT_TEMPLATE_ID].page,
      }),
    );
    await expect(buildLabelPdf([], { template: "avery-nope" })).rejects.toThrow(
      /Unknown label template/,
    );
    await expect(buildLabelPdf([], { template: { cols: 2 } })).rejects.toThrow(
      /missing/,
    );
  });
});
