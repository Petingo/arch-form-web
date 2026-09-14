"""Assemble the static site for GitHub Pages.

The site is written with absolute paths rooted at /arch-form-gpt/, which is how
it is served locally. On GitHub Pages it lives under the repository name, so
those paths are rewritten to the deployment base.

    python3 web/scripts/build_pages.py <output-dir> [--base /arch-form-web]

The output directory is a complete site: copy it into the Pages repository and
push. Everything the three tabs fetch is included, the Model Latent runtime
payloads included.
"""
import argparse
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE_BASE = "/arch-form-gpt/"

# Everything the site fetches at runtime, relative to the repository root.
TREES = [
    "web",
    "data/extracted",
    "jury-text-analysis/results",
    "model-latent-analysis/web/dist",
    "model-latent-analysis/web/vendor/three",
    "model-latent-analysis/web/src/3rdparty",
]

# Paths are rewritten inside these, bundle.js included -- the viewer's compiled
# bundle carries the absolute URLs from HTMLDoc.ts.
REWRITE_SUFFIXES = {".html", ".js", ".mjs", ".css", ".json", ".md"}

SKIP_DIRS = {"node_modules", "__pycache__", ".git"}

ROOT_INDEX = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Arch Form</title>
    <link rel="canonical" href="./web/" />
    <meta http-equiv="refresh" content="0; url=./web/" />
  </head>
  <body><p>Redirecting to <a href="./web/">Arch Form</a>&hellip;</p></body>
</html>
"""

# GitHub Pages serves this for any unmatched path under the project, so a
# mistyped link lands in the site rather than on a dead end.
NOT_FOUND = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Arch Form</title>
    <style>
      body {{ margin:0; min-height:100vh; display:grid; place-content:center; justify-items:center; gap:14px;
             background:#fff; color:#141714; font-family:"Manrope",system-ui,sans-serif; text-align:center; }}
      p {{ margin:0; color:#73786f; font:500 11px ui-monospace,monospace; letter-spacing:.1em; }}
      a {{ padding:9px 14px; border:1px solid #d9d8d0; color:inherit; text-decoration:none;
           font:500 10px ui-monospace,monospace; letter-spacing:.09em; }}
      a:hover {{ background:#efeee7; }}
    </style>
    <meta http-equiv="refresh" content="3; url={base}web/" />
  </head>
  <body>
    <p>THAT PAGE DOES NOT EXIST</p>
    <a href="{base}web/">GO TO ARCH FORM</a>
  </body>
</html>
"""


def copy_tree(relative: str, out: pathlib.Path) -> int:
    source = ROOT / relative
    if not source.exists():
        sys.exit(f"missing source tree: {relative}")
    target = out / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        source, target,
        ignore=shutil.ignore_patterns(*SKIP_DIRS),
        dirs_exist_ok=True,
    )
    return sum(1 for _ in target.rglob("*") if _.is_file())


def rewrite(out: pathlib.Path, base: str) -> int:
    changed = 0
    for path in out.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in REWRITE_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if SOURCE_BASE not in text:
            continue
        path.write_text(text.replace(SOURCE_BASE, base), encoding="utf-8")
        changed += 1
    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    parser.add_argument("--base", default="/arch-form-web",
                        help="URL prefix the site is served from")
    args = parser.parse_args()

    base = "/" + args.base.strip("/") + "/"
    out = pathlib.Path(args.output).resolve()
    if out.exists():
        for child in out.iterdir():
            if child.name == ".git":
                continue
            shutil.rmtree(child) if child.is_dir() else child.unlink()
    out.mkdir(parents=True, exist_ok=True)

    total = 0
    for tree in TREES:
        count = copy_tree(tree, out)
        print(f"  {tree:44s} {count:5d} files")
        total += count

    changed = rewrite(out, base)
    (out / ".nojekyll").touch()
    (out / "index.html").write_text(ROOT_INDEX, encoding="utf-8")
    (out / "404.html").write_text(NOT_FOUND.format(base=base), encoding="utf-8")

    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"\n{total} files, {size / 1024 / 1024:.0f} MB")
    print(f"rewrote {SOURCE_BASE} -> {base} in {changed} files")
    print(f"site root: {out}")


if __name__ == "__main__":
    main()
