/**
 * Paths and reach as one HTML page: the read instruments in, a string out. A view of core's
 * `pathsOf`, which does the counting; nothing here decides a number. Static: no script.
 */
import {
	type FlowInstrument,
	type FlowStep,
	type Paths,
	pathsOf,
	type ReadInstruments,
} from "@qretools/core";
import { CSS, esc } from "./page.ts";

export function pathsPageOf(read: ReadInstruments): string {
	const first = read.instruments[0];
	const title = first?.label ?? first?.name ?? "Instrument";
	const body = read.instruments
		.map((i) =>
			instrumentHtml(i, pathsOf(i, read.inputs), read.instruments.length > 1),
		)
		.join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}: paths and reach</title>
<style>${CSS}${PATHS_CSS}</style>
</head>
<body>
<header>
  <div>
    <h1>${esc(title)}: paths and reach</h1>
    <p class="muted">Every way through the routing, counted from the survey's DDI.</p>
  </div>
</header>
<main class="report">
${body}
</main>
</body>
</html>
`;
}

type Ask = Extract<FlowStep, { kind: "ask" }>;

/** The asks in written order, each with whether it sits in a section shown in random order. */
const asksOf = (
	steps: readonly FlowStep[],
	shuffled = false,
): [Ask, boolean][] =>
	steps.flatMap((s): [Ask, boolean][] => {
		switch (s.kind) {
			case "ask":
				return [[s, shuffled]];
			case "if":
				return [
					...s.branches.flatMap((b) => asksOf(b.then, shuffled)),
					...asksOf(s.else ?? [], shuffled),
				];
			case "stop":
				return [...asksOf(s.say, shuffled), ...asksOf(s.else, shuffled)];
			case "section":
				return asksOf(s.flow, shuffled || s.order !== undefined);
			case "count":
			case "repeat":
			case "loop":
				return asksOf(s.flow, shuffled);
			default:
				return [];
		}
	});

const n = (x: number): string => x.toLocaleString("en-US");
const plural = (x: number, one: string, many = `${one}s`) =>
	`${n(x)} ${x === 1 ? one : many}`;

/** The number of questions half the paths ask at most. */
function median(lengths: ReadonlyMap<number, number>, paths: number): number {
	let seen = 0;
	for (const [k, count] of lengths) {
		seen += count;
		if (seen * 2 >= paths) return k;
	}
	return 0;
}

/** Whether a question is asked on a run's paths: always means on every path not screened out. */
function when(
	id: string,
	run: {
		readonly paths: number;
		readonly stopped: number;
		readonly reach: ReadonlyMap<string, { readonly paths: number }>;
		readonly completed: ReadonlyMap<string, number>;
	},
): "always" | "never" | "depends" {
	const reached = run.reach.get(id)?.paths ?? 0;
	if (reached === 0) return "never";
	const done = run.paths - run.stopped;
	const always =
		done > 0 ? run.completed.get(id) === done : reached === run.paths;
	return always ? "always" : "depends";
}

const WHEN: Readonly<Record<ReturnType<typeof when>, string>> = {
	always: "Always",
	never: "Never",
	depends: "Depends on answers",
};

function instrumentHtml(i: FlowInstrument, p: Paths, heading: boolean): string {
	const asks = asksOf(i.flow);
	const lengths = [...p.lengths.keys()];
	const fewest = lengths[0] ?? 0;
	const most = lengths.at(-1) ?? 0;
	const reachOf = (a: Ask) => p.reach.get(a.id)?.paths ?? 0;
	const every = asks.filter(([a]) => when(a.id, p) === "always");
	const never = asks.filter(([a]) => reachOf(a) === 0);
	const shuffled = asks.some(([, s]) => s);
	const decided = (a: Ask): string => {
		const names = p.decidedBy.get(a.id) ?? [];
		if (names.length === 0) return `<span class="muted">Nothing</span>`;
		return names
			.map((v) => {
				const from = p.computes.get(v);
				return `<code>${esc(v)}</code>${from === undefined || from.length === 0 ? "" : ` <span class="muted">(from ${from.map((f) => `<code>${esc(f)}</code>`).join(", ")})</span>`}`;
			})
			.join(", ");
	};
	const askedOn = (a: Ask): string => {
		const r = reachOf(a);
		if (r === 0) return `<strong class="never">No path</strong>`;
		if (when(a.id, p) === "always") return "Every path";
		return `${n(r)} of ${n(p.paths)}`;
	};
	const before = (a: Ask): string => {
		const r = p.reach.get(a.id);
		if (r === undefined) return "";
		return r.fewest === r.most ? n(r.fewest) : `${n(r.fewest)} to ${n(r.most)}`;
	};
	const inputHeads = p.byInput
		.map(
			(b) =>
				`<th scope="col"><code>${esc(b.variable)}</code> ${esc(b.label)}</th>`,
		)
		.join("");
	const rows = asks
		.map(([a, s]) => {
			const cells = p.byInput
				.map((b) => {
					const w = when(a.id, b);
					return `<td class="${w}">${WHEN[w]}</td>`;
				})
				.join("");
			return `<tr${reachOf(a) === 0 ? ' class="unreached"' : ""}><th scope="row"><code>${esc(a.question.name)}</code></th><td>${askedOn(a)}</td>${cells}<td>${before(a)}${s ? " *" : ""}</td><td>${decided(a)}</td></tr>`;
		})
		.join("\n");
	const notes = [
		"A path is one outcome for each condition met, kept only if some answers lead there. Paths aren't respondents: they aren't weighted by how people answer, so a share of paths isn't a share of the sample.",
		"Conditions on one path agree with each other: two conditions on the same answer can't be taken in contradictory ways. A question not asked on a path counts as not answered.",
		"A question left unanswered is an answer here, so it can make a path of its own.",
		"Branches that change only what is said, and not which questions are asked, still count as paths.",
		...(p.stopped > 0
			? [
					`${plural(p.stopped, "path ends", "paths end")} at a screen-out. “Every path”, “Always” and the questions per path leave those out.`,
				]
			: []),
		...(p.repeated.length > 0
			? [
					`A roster's questions are counted once, as for one row. A roster by count has no rows when its count is blank or below 1. (${plural(p.repeated.length, "roster or loop", "rosters or loops")} here.)`,
				]
			: []),
		...(shuffled
			? [
					"* In a section shown in random order, “asked before” follows the written order.",
				]
			: []),
		...(p.unread > 0
			? [
					`${plural(p.unread, "condition")} couldn't be read, so both of ${p.unread === 1 ? "its" : "their"} outcomes are counted. The test form treats such a condition as never true.`,
				]
			: []),
		"Number answers are tried at the values the conditions compare them with and one either side, which is enough for comparisons with a single number.",
	];
	const id = esc(i.id);
	return `<section aria-labelledby="${id}">
${heading ? `<h2 id="${id}">${esc(i.label ?? i.name ?? i.id)}</h2>` : `<h2 id="${id}" class="visually-hidden">${esc(i.label ?? i.name ?? i.id)}</h2>`}
<dl class="summary">
  <div><dt>Paths</dt><dd>${n(p.paths)}${p.stopped > 0 ? ` <span class="muted">(${n(p.stopped)} screened out)</span>` : ""}</dd></div>
  <div><dt>Questions per path${p.stopped > 0 ? " not screened out" : ""}</dt><dd>${fewest === most ? n(fewest) : `${n(fewest)} to ${n(most)}`} <span class="muted">(median ${n(median(p.lengths, p.paths - p.stopped))})</span></dd></div>
  <div><dt>Asked on every path</dt><dd>${n(every.length)} of ${plural(asks.length, "question")}</dd></div>
  <div><dt>Never asked</dt><dd>${never.length === 0 ? "None" : `<strong class="never">${never.map(([a]) => `<code>${esc(a.question.name)}</code>`).join(", ")}</strong>`}</dd></div>
</dl>
<h3>How it's counted</h3>
<ul class="notes">
${notes.map((t) => `  <li>${esc(t)}</li>`).join("\n")}
</ul>
<h3 id="${id}-questions">Each question</h3>
<div class="scroll" role="region" aria-labelledby="${id}-questions" tabindex="0">
<table>
<thead><tr><th scope="col">Question</th><th scope="col">Asked on</th>${inputHeads}<th scope="col">Questions asked before</th><th scope="col">Decided by</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</section>`;
}

const PATHS_CSS = `
.report { max-width: 1100px; margin: 0 auto; padding: 16px; }
@media (min-width: 768px) { .report { padding: 24px; } }
.report section + section { margin-top: 32px; }
h3 { font-size: 14px; margin: 24px 0 8px; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 0; }
.summary div { border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; }
.summary dt { color: var(--muted); font-size: 12px; }
.summary dd { margin: 4px 0 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.summary dd .muted { font-size: 14px; font-weight: normal; }
.notes { margin: 0; padding-left: 20px; color: var(--muted); }
.notes li + li { margin-top: 4px; }
.scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; }
.scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; vertical-align: top; padding: 6px 12px; border-top: 1px solid var(--border); }
thead th { border-top: 0; background: var(--inset); font-size: 12px; font-weight: 600; white-space: nowrap; }
tbody th { font-weight: normal; white-space: nowrap; }
td.never, .never { color: var(--danger); }
tr.unreached th code { color: var(--danger); }
:root { --danger: #d1242f; }
@media (prefers-color-scheme: dark) { :root { --danger: #f85149; } }
`;
