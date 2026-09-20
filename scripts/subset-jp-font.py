#!/usr/bin/env python3
"""
字 · Cut Noto Serif JP down to the kanji this interface actually draws.

The Japanese in MangaCollector is the design, not the content: section
marks, seal names, the glossary, a kanji watermark per page. That is a
fixed set — a few hundred characters written into the source — and the
whole font is several megabytes. Google's font API solved this by
serving one of 120 slices on demand, at the cost of telling Google who
is reading. This script solves it once, at build time, by keeping only
the characters the source contains.

    python3 scripts/subset-jp-font.py

Run it after adding a kanji to the interface, and commit the two files
it writes. It scans `client/src` for CJK, adds the Japanese punctuation block,
and writes one woff2 per weight in use.

Source and licence: `@fontsource/noto-serif-jp`, SIL Open Font Licence
1.1, which allows a subset to be redistributed under the same licence —
`client/src/assets/fonts/LICENSE-noto-serif-jp.txt` travels with them.

What it deliberately does NOT cover is Japanese a reader types: a
custom series titled in kanji falls back to the system's Mincho
(Hiragino, Yu Mincho, Noto Serif CJK), which every desktop and phone
has. Shipping the glyphs for that would mean shipping the font.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "client" / "src"
PKG = ROOT / "client" / "node_modules" / "@fontsource" / "noto-serif-jp"
OUT = SRC / "assets" / "fonts"
WEIGHTS = ("400", "700")

# Kanji, kana, CJK punctuation, halfwidth katakana.
CJK = re.compile(r"[　-〿぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]")
# Always present, whatever the source says: the CJK punctuation block,
# 64 glyphs for under two kilobytes. The kana the interface uses come
# from the scan like everything else — carrying both syllabaries whole
# costs 51 kB a weight, and it would only serve text a reader typed,
# which falls back to the system Mincho regardless.
ALWAYS = "".join(chr(c) for c in range(0x3000, 0x3040))


def scan() -> set[str]:
    found: set[str] = set(ALWAYS)
    for path in SRC.rglob("*"):
        if path.suffix not in {".js", ".jsx", ".css", ".md", ".html"}:
            continue
        if not path.is_file():
            continue
        try:
            found.update(CJK.findall(path.read_text(encoding="utf-8")))
        except (UnicodeDecodeError, OSError):
            continue
    return found


def main() -> int:
    try:
        from fontTools import subset
    except ImportError:
        print("fonttools is required: pip install 'fonttools[woff]' brotli", file=sys.stderr)
        return 1

    chars = scan()
    scanned = len(chars) - len(ALWAYS)
    print(f"{scanned} CJK characters in the interface, {len(chars)} glyphs with the kana block")

    OUT.mkdir(parents=True, exist_ok=True)
    licence = PKG / "LICENSE"
    if licence.exists():
        (OUT / "LICENSE-noto-serif-jp.txt").write_text(licence.read_text(encoding="utf-8"))

    for weight in WEIGHTS:
        source = PKG / "files" / f"noto-serif-jp-japanese-{weight}-normal.woff2"
        if not source.exists():
            print(f"missing {source} — run pnpm install in client/", file=sys.stderr)
            return 1
        target = OUT / f"noto-serif-jp-ui-{weight}.woff2"
        args = [
            str(source),
            f"--text={''.join(sorted(chars))}",
            "--flavor=woff2",
            "--layout-features=*",
            "--no-hinting",
            f"--output-file={target}",
        ]
        subset.main(args)
        missing = coverage_gap(target, chars)
        print(
            f"  {target.relative_to(ROOT)}  "
            f"{source.stat().st_size / 1024:.0f} kB → {target.stat().st_size / 1024:.1f} kB"
            + (f"  ⚠ {len(missing)} not in the source font: {''.join(sorted(missing))}" if missing else "")
        )
    return 0


def coverage_gap(woff2: pathlib.Path, wanted: set[str]) -> set[str]:
    """Characters we asked for that the source font did not have."""
    from fontTools.ttLib import TTFont

    with TTFont(woff2) as font:
        have = {chr(c) for table in font["cmap"].tables for c in table.cmap}
    return {c for c in wanted if c not in have and not c.isspace()}


if __name__ == "__main__":
    raise SystemExit(main())
