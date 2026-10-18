#!/usr/bin/env python3
"""Builds index.html (the Labby design canvas gallery) from canvas.json.

Usage: python3 docs/design/canvas/build-index.py docs/design/canvas "NewBoard.dc.html,Other.dc.html"
The optional second argument lists boards still awaiting the owner's approval (flagged on the page).
"""
import html
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
d = json.load(open(root / "canvas.json"))
pages = d["pages"]
boards = d["boards"]
order = d["order"]
notes = d.get("notes", {})
pending = set(sys.argv[2].split(",")) if len(sys.argv) > 2 and sys.argv[2] else set()

# Row titles per page: the note with the largest y <= board.y on the same page.
rows_by_page = {}
for note in notes.values():
    if note.get("kind") != "title1":
        continue
    rows_by_page.setdefault(note.get("page", "redesign"), []).append((note["y"], note["text"]))
for rows in rows_by_page.values():
    rows.sort()


def row_title(page, y):
    title = None
    for ny, text in rows_by_page.get(page, []):
        if ny <= y:
            title = text
    return title


sections = []
for page in pages:
    items = [(name, boards[name]) for name in order if boards[name].get("page", "redesign") == page["id"]]
    if not items:
        continue
    groups = []
    for name, b in items:
        title = row_title(page["id"], b["y"])
        if not groups or groups[-1][0] != title:
            groups.append((title, []))
        groups[-1][1].append((name, b))
    sections.append((page, groups))


def card(name, b):
    w, h = b["w"], b["h"]
    scale = 0.5 if w <= 500 else 0.3
    status = ("pending", "Awaiting approval") if name in pending else ("approved", "Owner-approved")
    return f"""
      <article class="board" id="{html.escape(name.replace('.dc.html', ''))}">
        <div class="frame" style="--w:{w}px;--h:{h}px;--s:{scale}">
          <iframe src="{html.escape(name)}" title="{html.escape(b['title'])}" loading="lazy" width="{w}" height="{h}" scrolling="no"></iframe>
        </div>
        <div class="meta">
          <h4>{html.escape(b['title'])}</h4>
          <div class="meta-row">
            <span class="chip chip-{status[0]}">{status[1]}</span>
            <span class="dims">{w}×{h}</span>
            <a class="open" href="{html.escape(name)}" target="_blank" rel="noopener">Open full size</a>
          </div>
        </div>
      </article>"""


nav = "".join(
    f'<a href="#{html.escape(p["id"])}">{html.escape(p["name"])}</a>' for p, _ in sections
)
body_sections = []
for page, groups in sections:
    count = sum(len(g[1]) for g in groups)
    rows_html = []
    for title, items in groups:
        heading = f"<h3>{html.escape(title)}</h3>" if title else ""
        rows_html.append(f"""
    <div class="row">
      {heading}
      <div class="grid">{''.join(card(n, b) for n, b in items)}
      </div>
    </div>""")
    body_sections.append(f"""
  <section class="page" id="{html.escape(page['id'])}">
    <header class="page-head">
      <h2>{html.escape(page['name'])}</h2>
      <span class="count">{count} boards</span>
    </header>{''.join(rows_html)}
  </section>""")

total = sum(sum(len(g[1]) for g in groups) for _, groups in sections)
pending_count = len(pending)

page_html = f"""<title>Labby Design Canvas</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap">
<style>
  /* Layout: one long canvas, one section per milestone page, boards rendered live at scale in rows that mirror the original artboard rows. */
  :root {{
    --bg: #F7F6F9;          /* surface-page */
    --surface: #FFFFFF;
    --fg: #141018;
    --fg-2: #463C58;
    --muted: #6E6780;
    --line: #EEEBF2;
    --line-strong: #DCD8E2;
    --accent: #59128A;
    --accent-tint: #F1EAF8;
    --ok: #067647; --ok-bg: #ECFDF3;
    --warn: #93370D; --warn-bg: #FFF6E5;
    --font: Manrope, "Segoe UI", system-ui, sans-serif;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{
      --bg: #17131C; --surface: #211B28; --fg: #F3EFF7; --fg-2: #CFC6DB; --muted: #9A90AB;
      --line: #2E2637; --line-strong: #3E3449; --accent: #C89BE6; --accent-tint: #2C1C3A;
      --ok: #6FD3A0; --ok-bg: #11301F; --warn: #F2B46B; --warn-bg: #3A2A12; color-scheme: dark;
    }}
  }}
  :root[data-theme="dark"] {{
    --bg: #17131C; --surface: #211B28; --fg: #F3EFF7; --fg-2: #CFC6DB; --muted: #9A90AB;
    --line: #2E2637; --line-strong: #3E3449; --accent: #C89BE6; --accent-tint: #2C1C3A;
    --ok: #6FD3A0; --ok-bg: #11301F; --warn: #F2B46B; --warn-bg: #3A2A12; color-scheme: dark;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font); font-size: 15px; line-height: 1.5; }}
  .wrap {{ max-width: 1680px; margin: 0 auto; padding-inline: 20px; padding-block: 0 48px; }}
  .top {{ position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); }}
  .top-inner {{ max-width: 1680px; margin: 0 auto; padding: 14px 20px 0; display: flex; flex-direction: column; gap: 10px; }}
  .brand {{ display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px 16px; }}
  h1 {{ margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.4px; text-wrap: balance; }}
  .lede {{ margin: 0; color: var(--fg-2); max-width: 70ch; }}
  nav {{ display: flex; gap: 6px; overflow-x: auto; padding-bottom: 12px; scrollbar-width: thin; }}
  nav a {{ flex: none; padding: 7px 12px; border-radius: 10px; font-weight: 700; font-size: 13px; color: var(--fg-2); text-decoration: none; border: 1px solid var(--line-strong); background: var(--surface); }}
  nav a:hover, nav a:focus-visible {{ color: var(--accent); border-color: var(--accent); outline: none; }}
  .legend {{ display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; color: var(--muted); font-size: 13px; padding-block: 18px 6px; }}
  .page {{ padding-block: 26px 10px; border-bottom: 1px solid var(--line); scroll-margin-top: 120px; }}
  .page-head {{ display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }}
  h2 {{ margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.3px; }}
  .count {{ color: var(--muted); font-size: 13px; font-weight: 600; }}
  .row {{ padding-block: 16px 6px; }}
  h3 {{ margin: 0 0 12px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }}
  .grid {{ display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }}
  .board {{ min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; scroll-margin-top: 130px; }}
  .frame {{ width: calc(var(--w) * var(--s)); height: calc(var(--h) * var(--s)); max-width: 100%; overflow: hidden; background: #ECE9F0; border-bottom: 1px solid var(--line); }}
  .frame iframe {{ width: var(--w); height: var(--h); border: 0; transform: scale(var(--s)); transform-origin: top left; pointer-events: none; display: block; background: #fff; }}
  .meta {{ padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; max-width: calc(var(--w) * var(--s)); }}
  h4 {{ margin: 0; font-size: 13.5px; font-weight: 700; line-height: 1.35; }}
  .meta-row {{ display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12px; color: var(--muted); }}
  .chip {{ padding: 2px 8px; border-radius: 8px; font-weight: 700; font-size: 11.5px; }}
  .chip-approved {{ color: var(--ok); background: var(--ok-bg); }}
  .chip-pending {{ color: var(--warn); background: var(--warn-bg); }}
  .dims {{ font-variant-numeric: tabular-nums; }}
  .open {{ color: var(--accent); font-weight: 700; text-decoration: none; margin-inline-start: auto; }}
  .open:hover, .open:focus-visible {{ text-decoration: underline; outline: none; }}
  @media (max-width: 480px) {{
    .frame {{ --s: 0.42 !important; }}
    .board {{ max-width: 100%; }}
  }}
  @media (prefers-reduced-motion: no-preference) {{ html {{ scroll-behavior: smooth; }} }}
</style>
<div class="top">
  <div class="top-inner">
    <div class="brand">
      <h1>Labby Design Canvas</h1>
      <p class="lede">The owner-approved artboards for the rider app, driver app and admin dashboard (mobile 390×844, admin 1440 wide), one section per milestone. New screens land here first and are implemented only after approval.</p>
    </div>
    <nav aria-label="Milestone pages">{nav}</nav>
  </div>
</div>
<div class="wrap">
  <div class="legend">
    <span>{total} boards</span>
    <span class="chip chip-approved">Owner-approved</span>
    <span class="chip chip-pending">Awaiting approval</span>
    <span>{pending_count} awaiting approval</span>
    <span>Source of truth for tokens: docs/design/design-system.md</span>
  </div>{''.join(body_sections)}
</div>
"""
(root / "index.html").write_text(page_html)
print(f"wrote index.html: {total} boards, {pending_count} pending, {len(sections)} pages")
