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

def _is_header(line, tmp_path):
    """Is `line` rustfmt's `--emit stdout` filename banner?

    Two things defeated the obvious `line.strip() == tmp_path`:

      • rustfmt prints it *with a trailing colon*; and
      • on macOS `tempfile` hands back `/var/folders/…`, a symlink, while
        rustfmt prints the resolved `/private/var/folders/…`.

    So compare the real paths, with the colon off. Getting this wrong was
    invisible almost always — an insert at index 0 falls outside every
    touched range and is dropped — and bit only when the first changed
    range reached the top of the file. Which is exactly what CI does to
    every new file: it diffs against the branch base, so a file added on
    the branch is touched from line 1, the banner is written into it, and
    the script then reports its own damage as unformatted code.
    """
    candidate = line.strip().rstrip(":")
    if not candidate:
        return False
    return candidate == tmp_path or os.path.realpath(candidate) == os.path.realpath(tmp_path)


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
    # 頭 · rustfmt announces the file it formatted before printing it.
    # Two things made the old comparison never match (see `_is_header`),
    # so the header stayed in `fmt`.
    #
    # That was invisible almost always: an insert at index 0 falls outside
    # every touched range and gets dropped. It only lands in the file when
    # the first changed range reaches the top — adding a `//!` module
    # header, say. Which is precisely what CI does to *every* new file: it
    # diffs against the branch base, so a file added on the branch is
    # touched from line 1, the header is written into it, and the script
    # then reports its own damage as unformatted code.
    if lines and _is_header(lines[0], tmp_path):
        lines = lines[1:]
    if lines and lines[0].strip() == "":
        lines = lines[1:]
    return lines


def duplicated_declarations(work, out):
    """Declarations the merge left in the file twice.

    rustfmt re-sorts `use` and `pub mod` blocks as a whole. When only
    part of that reordering falls inside a touched hunk, the merge can
    keep the line in its new position *and* in its old one — and the file
    stops compiling. The loss guard below is the mirror image of this and
    catches neither, since it only looks for declarations that vanished.

    Reformatting never legitimately increases how many times a given
    `use x;` or `pub mod y;` appears, so counting them is exact.
    """
    def counts(ls):
        seen = {}
        for line in ls:
            text = line.strip()
            if text.startswith(("use ", "pub mod ", "mod ")):
                seen[text] = seen.get(text, 0) + 1
        return seen

    before, after = counts(work), counts(out)
    return sorted(d for d, n in after.items() if n > before.get(d, 0))


def duplicated_use_items(ls):
    """Items appearing twice inside one braced `use` list.

    The loss guard below compares whole `use ` lines, so it cannot see
    inside `use axum::{Json, extract::{…}}`. When rustfmt reorders the
    items and only part of the block is in a touched hunk, the merge can
    keep both orderings and leave an item twice — which does not compile,
    and which no check noticed.
    """
    dupes, block, inside = [], [], False
    for line in ls:
        text = line.strip()
        if not inside:
            if text.startswith("use ") and text.endswith("{"):
                inside, block = True, []
            continue
        if text.startswith("}"):
            seen = set()
            for item in block:
                if item in seen:
                    dupes.append(item)
                seen.add(item)
            inside = False
        elif text:
            block.append(text.rstrip(","))
    return dupes

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
    duped = duplicated_declarations(work, out) + duplicated_use_items(out)
    if duped:
        print(f"{path}: NOT WRITTEN — reflowing would duplicate {len(duped)} declaration(s):")
        for item in sorted(set(duped)):
            print(f"    {item}")
        print("    (rustfmt reordered the block and the merge kept both "
              "orderings; sort the declarations by hand)")
        return
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
