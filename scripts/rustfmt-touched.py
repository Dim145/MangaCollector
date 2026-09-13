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

`RUSTFMT_TOUCHED_BASE=<rev>` changes what "changed" is measured against.
Locally the default (`HEAD`, i.e. the uncommitted work) is what you want.
CI sets it to the base of the branch, where the changes are already
committed and a diff against HEAD would be empty — so without it the
check would pass by having nothing to look at.
"""
import difflib, os, re, subprocess, sys, tempfile, pathlib

BASE = os.environ.get("RUSTFMT_TOUCHED_BASE") or "HEAD"

def changed_ranges(path):
    out = subprocess.run(["git", "diff", "-U0", BASE, "--", path], capture_output=True, text=True).stdout
    ranges = []
    for m in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", out, re.M):
        start = int(m.group(1)); count = int(m.group(2)) if m.group(2) is not None else 1
        ranges.append((start, start + max(count, 1)))  # 1-based [start, end)
    return ranges

def formatted_lines(path):
    src = pathlib.Path(path).read_text()
    # `delete=False` plus no cleanup left one copy of every file it
    # formatted in the system temp dir — source, on every run.
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = str(pathlib.Path(tmp_dir) / "touched.rs")
        pathlib.Path(tmp_path).write_text(src)
        # `skip_children` keeps rustfmt on the one file we handed it.
        # Without it a crate root (main.rs, lib.rs) makes rustfmt follow
        # its `mod` declarations — which don't resolve next to a temp
        # copy, so it errored out, printed nothing, and the script
        # reported "rustfmt produced nothing, skipped". Every edit to
        # main.rs had been going unformatted. (It is a config key, not a
        # flag: `--skip-children` is not recognised by rustfmt 1.9.)
        res = subprocess.run(
            ["rustfmt", "--edition", "2024", "--config", "skip_children=true",
             "--emit", "stdout", tmp_path],
            capture_output=True,
            text=True,
        )
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
    # 移 · rustfmt re-sorts `use` declarations across the WHOLE block, so
    # an edit next to an import can make it move a line out of a touched
    # hunk and into one we are deliberately not applying. The line is
    # then in neither half of the output and the file stops compiling —
    # this happened, silently, on the import block of main.rs. Compare
    # the set of imports before and after and refuse to write a file
    # that lost one.
    def imports(ls):
        return sorted(l.strip() for l in ls if l.lstrip().startswith("use "))
    lost = set(imports(work)) - set(imports(out))
    if lost:
        print(f"{path}: NOT WRITTEN — reflowing would drop {len(lost)} import(s):")
        for l in sorted(lost):
            print(f"    {l}")
        print("    (rustfmt reordered them out of the touched hunks; "
              "reformat the import block by hand or widen the edit)")
        return
    pathlib.Path(path).write_text("".join(out))
    print(f"{path}: {applied} hunk(s) reflowed, {len(ranges)} changed range(s)")

for p in sys.argv[1:]:
    main(p)
