/**
 * The test form as one HTML page: the read instruments in, a string out. The instruments
 * go in as JSON (each Map as `{ $map: entries }`, rebuilt as a Map in the page); the
 * runtime, `walk` and core's `evaluateCondition` go in as their own source text, each
 * passed to the next as an argument, so a bundler renaming them can't break the page.
 */
import { evaluateCondition, type ReadInstruments } from "@qretools/core";
import { runtime } from "./runtime.ts";
import { walk } from "./walk.ts";

export function pageOf(read: ReadInstruments): string {
	const first = read.instruments[0];
	const title = first?.label ?? first?.name ?? "Instrument";
	const json = JSON.stringify(read, (_k, v) =>
		v instanceof Map ? { $map: [...v] } : v,
	).replace(/</g, "\\u003c");
	const revive = `(_k, v) => v !== null && typeof v === "object" && Array.isArray(v.$map) ? new Map(v.$map) : v`;
	const script = `(${runtime})((${evaluateCondition}), (${walk}), JSON.parse(document.getElementById("form-data").textContent, ${revive}));`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}: test form</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <div>
    <h1>${esc(title)}</h1>
    <p class="muted">A test form: it follows the survey's routing and saves nothing.</p>
  </div>
  <div class="actions">
    <button type="button" id="random">Random answers</button>
    <button type="button" class="info" popovertarget="random-help" aria-label="About random answers"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg></button>
    <div id="random-help" popover>
      <p>Runs the interview for you, answering each question until it ends:</p>
      <ul>
        <li>a choice gets one of its options, each as likely, even where several may be ticked;</li>
        <li>a number gets a whole number in its range (0 to 10 if it has no limits);</li>
        <li>anything else gets the words “A typed answer”.</li>
      </ul>
      <p>About one question in 20 is left unanswered. Before a run starts, an empty input with options gets one at random. Pressed partway through, it finishes the run from there.</p>
    </div>
    <button type="button" id="restart">Start again</button>
  </div>
</header>
<div class="layout">
  <main id="screen"></main>
  <aside id="panel" aria-label="This run"></aside>
</div>
<div id="live" class="visually-hidden" aria-live="polite"></div>
<script type="application/json" id="form-data">${json}</script>
<script>${script.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Primer's colour tokens, light and dark, as plain values: the page loads nothing.
const CSS = `
:root {
  color-scheme: light dark;
  --fg: #1f2328; --muted: #59636e; --bg: #ffffff; --inset: #f6f8fa; --border: #d1d9e0;
  --accent: #0969da; --accent-fg: #ffffff; --skip: #9a6700;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root { --fg: #f0f6fc; --muted: #9198a1; --bg: #0d1117; --inset: #151b23; --border: #3d444d;
    --accent: #4493f8; --accent-fg: #ffffff; --skip: #d29922; }
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 var(--font); color: var(--fg); background: var(--bg); }
code { font-family: var(--mono); font-size: 12px; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 16px; margin: 0 0 8px; }
h2:focus { outline: none; }
h2:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
h2 .name { margin-left: 8px; color: var(--muted); font-weight: normal; }
header { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: center;
  padding: 16px; border-bottom: 1px solid var(--border); }
header p { margin: 0; }
.layout { display: grid; gap: 24px; padding: 16px; max-width: 1100px; margin: 0 auto;
  grid-template-columns: minmax(0, 1fr); }
@media (min-width: 768px) { .layout { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); padding: 24px; } }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.eyebrow { margin: 0 0 4px; font-size: 12px; color: var(--muted); min-height: 1.5em; }
.card { border: 1px solid var(--border); border-radius: 6px; padding: 16px; }
.qtext { white-space: pre-line; font-size: 16px; padding: 0; margin: 8px 0 12px; }
fieldset { border: 0; padding: 0; margin: 0 0 12px; min-width: 0; }
legend { padding: 0; margin-bottom: 4px; }
.choice { display: flex; gap: 8px; align-items: baseline; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.choice:hover { background: var(--inset); }
.choice input { margin: 0; flex-shrink: 0; }
.choice .code { margin-left: auto; color: var(--muted); font-family: var(--mono); font-size: 12px; }
.field { display: grid; gap: 4px; margin-bottom: 12px; }
.field input { font: inherit; color: inherit; background: var(--bg); padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; min-height: 32px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
button { font: inherit; font-weight: 500; color: var(--fg); background: var(--inset); border: 1px solid var(--border);
  border-radius: 6px; padding: 5px 16px; cursor: pointer; min-height: 32px; }
button:hover { border-color: var(--muted); }
button.info { display: inline grid; place-items: center; width: 32px; padding: 0; margin-left: -4px; color: var(--muted);
  background: transparent; border-color: transparent; anchor-name: --random-help; }
button.info:hover { color: var(--fg); background: var(--inset); }
#random-help { max-width: min(360px, calc(100vw - 32px)); padding: 12px 16px; color: var(--fg); background: var(--bg);
  border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.2); }
#random-help p { margin: 0; }
#random-help ul { margin: 8px 0; padding-left: 20px; }
/* Under the icon where anchor positioning works; centred, the popover's default, where it doesn't. */
@supports (position-area: block-end) {
  #random-help { position-anchor: --random-help; inset: auto; margin: 4px 0;
    position-area: block-end span-inline-start; position-try-fallbacks: flip-block; }
  /* On a phone, the screen's width less its gutters, not the space left of the icon. */
  @media (max-width: 543px) { #random-help { position-area: block-end span-all; inset-inline: 16px; max-width: none; } }
}
button.primary { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
aside h2 { font-size: 14px; margin-top: 16px; }
aside h2:first-child { margin-top: 0; }
aside ul { margin: 4px 0; padding-left: 20px; }
.values { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 0; }
.values dd { margin: 0; overflow-wrap: anywhere; }
.path { list-style: none; padding: 0; margin: 0; border: 1px solid var(--border); border-radius: 6px; }
.path li { padding: 4px 8px; border-top: 1px solid var(--border); overflow-wrap: anywhere; }
.path li:first-child { border-top: 0; }
.path .n { display: inline-block; min-width: 2.5em; color: var(--muted); }
.path .event { color: var(--muted); font-size: 12px; padding-left: 2.5em; }
.path .skip, .path .note { color: var(--skip); }
.path .section { font-weight: 600; background: var(--inset); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`;
