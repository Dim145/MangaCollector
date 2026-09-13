#!/usr/bin/env python3
"""Apply rustfmt only to the hunks that overlap lines changed since HEAD.

The Rust tree is not clean under rustfmt 1.9: a blind `cargo fmt` reflows
dozens of untouched files and buries a real change in noise. This formats
each file in memory, then keeps the formatted version only where it
intersects a `git diff -U0 HEAD` range (±2 lines) — everything else stays
exactly as it was, pre-existing drift included.

    python3 scripts/rustfmt-touched.py server/src/services/library.rs [more files…]

Run it from anywhere inside the repository, before `cargo test`; then check
with `rustfmt --edition 2024 --check <file>` that the diff count did not go
up compared with `git show HEAD:<file>`.
"""
import difflib, re, subprocess, sys, tempfile, pathlib

def changed_ranges(path):
    out = subprocess.run(["git", "diff", "-U0", "HEAD", "--", path], capture_output=True, text=True).stdout
    ranges = []
    for m in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", out, re.M):
        start = int(m.group(1)); count = int(m.group(2)) if m.group(2) is not None else 1
        ranges.append((start, start + max(count, 1)))  # 1-based [start, end)
    return ranges

def formatted_lines(path):
    src = pathlib.Path(path).read_text()
    with tempfile.NamedTemporaryFile("w", suffix=".rs", delete=False) as tmp:
        tmp.write(src); tmp_path = tmp.name
    res = subprocess.run(["rustfmt", "--edition", "2024", "--emit", "stdout", tmp_path], capture_output=True, text=True)
    lines = res.stdout.splitlines(keepends=True)
    if lines and lines[0].strip() == tmp_path:
        lines = lines[1:]
    if lines and lines[0].strip() == "":
        lines = lines[1:]
    return lines

def main(path):
    work = pathlib.Path(path).read_text().splitlines(keepends=True)
    fmt = formatted_lines(path)
    if not fmt:
        print(f"{path}: rustfmt produced nothing, skipped"); return
    ranges = changed_ranges(path)
    def touched(i1, i2):
        lo, hi = i1 + 1 - 2, i2 + 1 + 2
        return any(not (e <= lo or s >= hi) for s, e in ranges)
    out, applied = [], 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, work, fmt, autojunk=False).get_opcodes():
        if tag == "equal" or not touched(i1, i2):
            out.extend(work[i1:i2])
        else:
            out.extend(fmt[j1:j2]); applied += 1
    pathlib.Path(path).write_text("".join(out))
    print(f"{path}: {applied} hunk(s) reflowed, {len(ranges)} changed range(s)")

for p in sys.argv[1:]:
    main(p)
