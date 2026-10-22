/**
 * A codebook as HTML: strings in, strings out, every one escaped where it is written.
 * Pure, as the model is: no DOM, so the page can be written by a command, a test or a
 * custom element alike.
 */

import { itemKeyOf } from "@qretools/core";
import type { Asking, Command } from "./flow.ts";
import type {
	Codebook,
	Described,
	Entry,
	Format,
	Listed,
	Row,
} from "./model.ts";
import type { Ref, Span, Text } from "./text.ts";

const ENTITIES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Text safe in a text node or a double-quoted attribute value: nothing in it can end either. */
export const escapeHtml = (s: string): string =>
	s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/**
 * The id of an item's anchor: its key at every version (`agency:id`), so a permalink
 * survives an edit that gives the item a new version, and a reference to an older
 * version still finds it. Every such id holds a colon, so the codebook's own ids
 * (`ddi-contents`, …) can't collide with one. None for a URN that isn't one, or whose key
 * holds whitespace, which an id can't, or half a character, which a link can't name.
 */
export const anchorOf = (urn: string): string | undefined => {
	const key = itemKeyOf(urn);
	return key === undefined || /\s/.test(key) || LONE.test(key)
		? undefined
		: key;
};

/** A UTF-16 surrogate without its pair: with the `u` flag, a pair is one character. */
const LONE = /[\uD800-\uDFFF]/u;

/**
 * A link to an anchor on the page. Colons are allowed in a fragment and keep it
 * readable; anything else encoded (`@`, `$`, `#`) still finds its id, since a browser
 * looks for the fragment's percent-decoded form too (HTML's "find a potential indicated
 * element"). Total: half a character, which can't be encoded, is written as U+FFFD.
 */
export const hrefOf = (anchor: string): string =>
	`#${encodeURIComponent(anchor.replace(/[\uD800-\uDFFF]/gu, "\uFFFD")).replaceAll("%3A", ":")}`;

/** How text is written where it is: `inLink` inside an `<a>`, where another link can't go. */
interface Context extends Options {
	/** The anchors the page has: a reference to anything else is named, not linked. */
	readonly anchors: ReadonlySet<string>;
	/** ` lang="en"` for the page's own words, where the page isn't in English; else "". */
	readonly en: string;
	readonly inLink?: boolean;
}

/** What a host decides about the codebook it shows. */
export interface Options {
	/**
	 * Where a reference goes, when the host knows better than the page (an app opening
	 * the item's file): an address, else undefined (or "") for the anchor on the page, if
	 * any.
	 */
	readonly href?: (ref: Ref) => string | undefined;
}

function spanHtml(s: Span, { anchors, inLink, href }: Context): string {
	switch (s.kind) {
		case "text":
			return escapeHtml(s.text);
		case "code":
			return `<code>${escapeHtml(s.text)}</code>`;
		case "link":
			// Only http(s) addresses become links (text.ts), so escaping is all the href needs.
			return inLink
				? escapeHtml(s.text)
				: `<a href="${escapeHtml(s.url)}" rel="external">${escapeHtml(s.text)}</a>`;
		case "ref": {
			const anchor = anchorOf(s.urn);
			const data = `data-urn="${escapeHtml(s.urn)}" data-kind="${escapeHtml(s.type)}"${s.name === undefined ? "" : ` data-name="${escapeHtml(s.name)}"`}`;
			const words = escapeHtml(s.name ?? s.urn);
			const to = inLink
				? undefined
				: // An empty address is no destination: it would reload the page.
					href?.(s) ||
					(anchor !== undefined && anchors.has(anchor)
						? hrefOf(anchor)
						: undefined);
			return to === undefined
				? `<span ${data}>${words}</span>`
				: `<a href="${escapeHtml(to)}" ${data}>${words}</a>`;
		}
		default:
			return s satisfies never;
	}
}

/** Text where a paragraph can't go (a heading, a table cell, a link): its paragraphs run on. */
export const inlineHtml = (text: Text, context: Context): string =>
	text.map((p) => p.map((s) => spanHtml(s, context)).join("")).join(" ");

/** Text as paragraphs. */
export const blockHtml = (text: Text, context: Context): string =>
	text
		.map((p) => `<p>${p.map((s) => spanHtml(s, context)).join("")}</p>`)
		.join("");

/** Words with the names a backtick marks (a finding's message) as code. */
const marked = (s: string): Text => [
	s
		.split("`")
		.flatMap((text, i): Span[] =>
			text === "" ? [] : [{ kind: i % 2 === 1 ? "code" : "text", text }],
		),
];

/** The page's own words amid the document's, marked English where the page isn't. */
const english = (words: string, cx: Context): string =>
	cx.en === "" ? words : `<span${cx.en}>${words}</span>`;

/**
 * One `<dt>` and its `<dd>`, nothing when there is nothing to say. The term is the page's
 * words; so is a `phrase` (where it is asked, a format), a document's word or two in it aside.
 */
const pair = (
	cx: Context,
	term: string,
	html: string | undefined,
	phrase = false,
): string =>
	html === undefined || html === ""
		? ""
		: `<dt${cx.en}>${term}</dt><dd${phrase ? cx.en : ""}>${html}</dd>`;

const dl = (pairs: readonly string[]): string =>
	pairs.join("") === "" ? "" : `<dl>${pairs.join("")}</dl>`;

/** "1 variable", "13 variables". */
const count = (n: number, one: string, many: string): string =>
	`${n} ${n === 1 ? one : many}`;

/** The first letter upper case: a phrase made of lower-case parts starts a line. */
const sentence = (s: string): string =>
	s === "" ? s : `${s[0]?.toUpperCase()}${s.slice(1)}`;

/** A command as written, its program language after it. */
const commandHtml = (c: Command): string =>
	`<code>${escapeHtml(c.command)}</code>${c.language === undefined ? "" : ` <span class="language">(${escapeHtml(c.language)})</span>`}`;

/** One place a question is asked, as a phrase: its conditions, loops and orders. */
function askingHtml(a: Asking, cx: Context): string {
	const conditions = a.conditions.map(
		(c) => `${c.negated ? "unless" : "if"} ${commandHtml(c)}`,
	);
	const parts = [
		conditions.join(" and "),
		...a.loops.map((l) =>
			l.name === undefined
				? "repeated in a loop"
				: `repeated in ${inlineHtml([[l]], cx)}`,
		),
		a.order === undefined ? "" : `section order: ${escapeHtml(a.order)}`,
		a.responseOrder === undefined
			? ""
			: `option order: ${escapeHtml(a.responseOrder)}`,
	].filter((p) => p !== "");
	return sentence(parts.length === 0 ? "always" : parts.join("; "));
}

/** Where a question is asked; nothing when it is asked once, always, as it is. */
function askedHtml(asked: readonly Asking[], cx: Context): string | undefined {
	const places = asked.map((a) => askingHtml(a, cx));
	if (places.length === 0 || (places.length === 1 && places[0] === "Always"))
		return undefined;
	return places.length === 1
		? places[0]
		: `<ul>${places.map((p) => `<li>${p}</li>`).join("")}</ul>`;
}

function formatHtml(f: Format): string {
	if (f.kind === "text")
		return f.maxLength === undefined
			? "Text"
			: `Text, up to ${f.maxLength} characters`;
	const range =
		f.min !== undefined && f.max !== undefined
			? ` from ${f.min} to ${f.max}`
			: f.min !== undefined
				? `, at least ${f.min}`
				: f.max !== undefined
					? `, at most ${f.max}`
					: "";
	const decimals =
		f.decimals === undefined
			? ""
			: `, ${count(f.decimals, "decimal place", "decimal places")}`;
	const unit = f.unit === undefined ? "" : `, in ${escapeHtml(f.unit)}`;
	return `Number${range}${decimals}${unit}`;
}

const refsHtml = (refs: readonly Ref[], cx: Context): string =>
	refs.map((r) => inlineHtml([[r]], cx)).join(", ");

const rowHtml = (r: Row, cx: Context): string =>
	`<tr><th scope="row"><code>${escapeHtml(r.code)}</code></th><td>${r.label === undefined ? "" : inlineHtml(r.label, cx)}</td></tr>`;

/**
 * Codes and their labels, valid ones first, then missing ones under a heading of their
 * own; a table of missing values alone is captioned so. `from` names the lists.
 */
function tableHtml(rows: readonly Row[], from: string, cx: Context): string {
	const valid = rows.filter((r) => !r.missing);
	const missing = rows.filter((r) => r.missing);
	if (rows.length === 0) return "";
	const caption = `${valid.length === 0 ? "Missing values" : "Values"}${from === "" ? "" : ` <span class="from">from ${from}</span>`}`;
	const body = (rs: readonly Row[]) => rs.map((r) => rowHtml(r, cx)).join("");
	return `<table><caption${cx.en}>${caption}</caption><thead${cx.en}><tr><th scope="col">Code</th><th scope="col">Label</th></tr></thead>${
		valid.length === 0
			? `<tbody>${body(missing)}</tbody>`
			: `<tbody>${body(valid)}</tbody>${
					missing.length === 0
						? ""
						: `<tbody class="missing"><tr><th scope="rowgroup" colspan="2"${cx.en}>Missing values</th></tr>${body(missing)}</tbody>`
				}`
	}</table>`;
}

const idAttr = (urn: string): string => {
	const anchor = anchorOf(urn);
	return anchor === undefined ? "" : ` id="${escapeHtml(anchor)}"`;
};

/** A heading's words: the name as code, then the label. */
const titleHtml = (
	name: string | undefined,
	label: Text | undefined,
	urn: string,
	cx: Context,
): string =>
	[
		name === undefined ? "" : `<code>${escapeHtml(name)}</code>`,
		label === undefined ? "" : inlineHtml(label, cx),
	]
		.filter((s) => s !== "")
		.join(" ") || `<span class="urn">${escapeHtml(urn)}</span>`;

/** A question's words: its text as quoted, then what the interviewer is told. */
const questionHtml = (q: NonNullable<Entry["question"]>, cx: Context): string =>
	`${q.text === undefined ? "" : `<blockquote>${blockHtml(q.text, cx)}</blockquote>`}${q.instructions
		.map((i) => `<div class="instruction">${blockHtml(i, cx)}</div>`)
		.join("")}`;

/** A variable's entry, or a question's no variable records. */
function entryHtml(e: Entry, level: 3 | 4, cx: Context): string {
	const rows = e.responses?.rows ?? [];
	const missing = rows.filter((r) => r.missing);
	const made = e.derivation;
	const particulars = dl([
		pair(
			cx,
			"Concept",
			e.concepts.length > 0 ? refsHtml(e.concepts, cx) : undefined,
		),
		pair(
			cx,
			"Universe",
			e.universes.length > 0 ? refsHtml(e.universes, cx) : undefined,
		),
		pair(cx, "Asked", askedHtml(e.asked, cx), true),
		pair(
			cx,
			"Intent",
			e.intent === undefined ? undefined : blockHtml(e.intent, cx),
		),
		pair(
			cx,
			"Answers",
			e.responses?.many === true ? "Select all that apply" : undefined,
			true,
		),
		pair(
			cx,
			"Format",
			e.format === undefined ? undefined : formatHtml(e.format),
			true,
		),
		// The missing codes on one line, where the table also has valid ones to read past.
		pair(
			cx,
			"Missing values",
			missing.length > 0 && missing.length < rows.length
				? missing.map((r) => `<code>${escapeHtml(r.code)}</code>`).join(", ")
				: undefined,
		),
		pair(
			cx,
			"Made from",
			made === undefined
				? undefined
				: [
						...made.commands.map((c) => `<p>${commandHtml(c)}</p>`),
						made.from.length === 0
							? ""
							: `<p>${english("From", cx)} ${refsHtml(made.from, cx)}</p>`,
						made.text === undefined ? "" : blockHtml(made.text, cx),
					].join(""),
		),
	]);
	const more = dl([
		pair(
			cx,
			"Notes",
			e.notes === undefined ? undefined : blockHtml(e.notes, cx),
		),
		pair(
			cx,
			"Source",
			e.source === undefined
				? undefined
				: [
						e.source.text === undefined ? "" : blockHtml(e.source.text, cx),
						e.source.based.length === 0
							? ""
							: `<p>${english("Based on", cx)} ${e.source.based.map((u) => `<code>${escapeHtml(u)}</code>`).join(", ")}</p>`,
					].join(""),
		),
		pair(
			cx,
			"Version",
			e.version === undefined ? undefined : escapeHtml(e.version),
		),
		pair(
			cx,
			"Identifiers",
			e.provenance === undefined
				? undefined
				: [
						...e.provenance.ids.map(
							(i) =>
								`<code>${escapeHtml(i.value)}</code>${i.type === undefined ? "" : ` <span class="language">(${escapeHtml(i.type)})</span>`}`,
						),
						...e.provenance.attributes.map(
							(a) =>
								`${escapeHtml(a.key)}: <code>${escapeHtml(a.value)}</code>`,
						),
					]
						.map((line) => `<p>${line}</p>`)
						.join(""),
		),
	]);
	const option =
		e.group === undefined
			? ""
			: `<p class="option">${english("Option", cx)} <code>${escapeHtml(e.group.option.code)}</code>${e.group.option.label === undefined ? "" : ` ${inlineHtml(e.group.option.label, cx)}`}</p>`;
	const question =
		e.question === undefined || e.group !== undefined
			? ""
			: questionHtml(e.question, cx);
	// Only lists with a name: a URN in a caption says nothing a reader can use.
	const from = refsHtml(
		(e.responses?.from ?? []).filter((r) => r.name !== undefined),
		cx,
	);
	return `<article${idAttr(e.urn)}><h${level}>${titleHtml(e.name, e.label, e.urn, cx)}</h${level}>${option}${question}${particulars}${tableHtml(rows, from, cx)}${more === "" ? "" : `<footer>${more}</footer>`}</article>`;
}

/** Entries in order, the options of a select-all question together under its words, where its first option is. */
type Block =
	| { readonly kind: "entry"; readonly entry: Entry }
	| {
			readonly kind: "group";
			readonly question: NonNullable<Entry["question"]>;
			readonly options: readonly Entry[];
	  };

/** A question's key at every version, so options citing two versions of it stay together. */
const groupKey = (urn: string): string => anchorOf(urn) ?? urn;

function blocksOf(entries: readonly Entry[]): Block[] {
	const blocks: Block[] = [];
	const seen = new Set<string>();
	for (const e of entries) {
		if (e.group === undefined || e.question === undefined) {
			blocks.push({ kind: "entry", entry: e });
			continue;
		}
		const key = groupKey(e.group.question);
		if (seen.has(key)) continue;
		seen.add(key);
		blocks.push({
			kind: "group",
			question: e.question,
			options: entries.filter(
				(o) => o.group !== undefined && groupKey(o.group.question) === key,
			),
		});
	}
	return blocks;
}

function blockOfHtml(b: Block, cx: Context): string {
	if (b.kind === "entry") return entryHtml(b.entry, 3, cx);
	const q = b.question;
	return `<section${idAttr(q.urn)} class="group"><h3>${titleHtml(q.name, undefined, q.urn, cx)}</h3>${questionHtml(q, cx)}<p class="answers"${cx.en}>Select all that apply, each option a variable of its own</p>${b.options.map((o) => entryHtml(o, 4, cx)).join("")}</section>`;
}

/** A shared item: its name and label, its description or its codes. */
const sharedHtml = (it: Described | Listed, cx: Context): string =>
	`<article${idAttr(it.urn)}><h4>${titleHtml(it.name, it.label, it.urn, cx)}</h4>${
		"rows" in it
			? tableHtml(it.rows, "", cx)
			: it.description === undefined
				? ""
				: blockHtml(it.description, cx)
	}</article>`;

/** The kinds of shared item, in the order the page lists them, with their sections' ids. */
const SHARED = [
	{ key: "concepts", id: "ddi-concepts", title: "Concepts" },
	{ key: "universes", id: "ddi-universes", title: "Universes" },
	{ key: "codeLists", id: "ddi-code-lists", title: "Code lists" },
	{ key: "missing", id: "ddi-missing-values", title: "Missing values" },
] as const;

/** A link in the contents: an entry's name and label, no link inside it. */
const contentsLink = (
	urn: string,
	name: string | undefined,
	label: Text | undefined,
	cx: Context,
): string => {
	const anchor = anchorOf(urn);
	const words = titleHtml(name, label, urn, { ...cx, inLink: true });
	return anchor === undefined
		? words
		: `<a href="${hrefOf(anchor)}">${words}</a>`;
};

function contentsHtml(
	cb: Codebook,
	blocks: readonly Block[],
	cx: Context,
): string {
	const entries = blocks.map((b) =>
		b.kind === "entry"
			? `<li>${contentsLink(b.entry.urn, b.entry.name, b.entry.label, cx)}</li>`
			: `<li>${contentsLink(b.question.urn, b.question.name, undefined, cx)}<ol>${b.options
					.map((o) => `<li>${contentsLink(o.urn, o.name, o.label, cx)}</li>`)
					.join("")}</ol></li>`,
	);
	const shared = SHARED.filter((s) => cb.shared[s.key].length > 0).map(
		(s) => `<li><a href="#${s.id}">${s.title}</a></li>`,
	);
	// What isn't a variable is listed apart, so the variables' numbers are theirs alone.
	const rest = [
		shared.length === 0
			? ""
			: `<li><a href="#ddi-shared">Shared</a><ol>${shared.join("")}</ol></li>`,
		cb.findings.length === 0
			? ""
			: `<li><a href="#ddi-broken">Broken references</a></li>`,
	].join("");
	return `<nav aria-labelledby="ddi-contents"><h2 id="ddi-contents"${cx.en}>Contents</h2><ol>${entries.join("")}</ol>${rest === "" ? "" : `<ul${cx.en}>${rest}</ul>`}</nav>`;
}

/** The anchors a codebook's HTML has: its entries', its select-all questions' and its shared items'. */
const anchorsOf = (cb: Codebook, blocks: readonly Block[]): Set<string> =>
	new Set(
		[
			...cb.entries.map((e) => e.urn),
			...blocks.flatMap((b) => (b.kind === "group" ? [b.question.urn] : [])),
			...SHARED.flatMap((s) => cb.shared[s.key].map((it) => it.urn)),
		].flatMap((urn) => {
			const anchor = anchorOf(urn);
			return anchor === undefined ? [] : [anchor];
		}),
	);

/**
 * A codebook as HTML to place in a page: the contents, then each entry, then the shared
 * items they refer to, then any reference that leads nowhere, each part headed by an
 * `<h2>`. No landmark but the contents' `<nav>`, no `<h1>`, no style: what holds it
 * (`pageOf`, `<ddi-codebook>`) says what it is part of. The codebook's own text is in
 * the language it was read in, which what holds it says; its own words are English,
 * marked so unless that language is English.
 */
export function codebookHtml(cb: Codebook, options: Options = {}): string {
	const blocks = blocksOf(cb.entries);
	const english = cb.lang !== undefined && /^en(-|$)/i.test(cb.lang);
	const cx: Context = {
		...options,
		anchors: anchorsOf(cb, blocks),
		en: english ? "" : ' lang="en"',
	};
	const shared = SHARED.filter((s) => cb.shared[s.key].length > 0)
		.map(
			(s) =>
				`<section aria-labelledby="${s.id}"><h3 id="${s.id}"${cx.en}>${s.title}</h3>${cb.shared[
					s.key
				]
					.map((it) => sharedHtml(it, cx))
					.join("")}</section>`,
		)
		.join("");
	const broken =
		cb.findings.length === 0
			? ""
			: `<section aria-labelledby="ddi-broken"${cx.en}><h2 id="ddi-broken">Broken references</h2><ul>${cb.findings
					.map((f) => `<li>${inlineHtml(marked(f.message), cx)}</li>`)
					.join("")}</ul></section>`;
	return `${contentsHtml(cb, blocks, cx)}
<section aria-labelledby="ddi-variables"><h2 id="ddi-variables"${cx.en}>Variables</h2>${blocks.map((b) => blockOfHtml(b, cx)).join("")}</section>
${shared === "" ? "" : `<section aria-labelledby="ddi-shared"><h2 id="ddi-shared"${cx.en}>Shared</h2>${shared}</section>`}
${broken}`;
}

/**
 * A codebook as one HTML page: everything inline (its style too), no script, nothing
 * fetched. Its title and count, then the codebook. The page is in the language the
 * codebook was read in (none when the document writes none).
 */
export function pageOf(cb: Codebook): string {
	const title = cb.title ?? "Codebook";
	const english = cb.lang !== undefined && /^en(-|$)/i.test(cb.lang);
	const variables = cb.entries.filter((e) => e.type === "Variable").length;
	const questions = cb.entries.length - variables;
	const counted = [
		variables > 0 || questions === 0
			? count(variables, "variable", "variables")
			: "",
		questions > 0 ? count(questions, "question", "questions") : "",
	]
		.filter((s) => s !== "")
		.join(", ");
	return `<!doctype html>
<html${cb.lang === undefined ? "" : ` lang="${escapeHtml(cb.lang)}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:,">
<style>${STYLE}${PAGE_STYLE}</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1><p class="count"${english ? "" : ' lang="en"'}>${counted}</p></header>
<main>
${codebookHtml(cb)}
</main>
</body>
</html>
`;
}

/**
 * The page's own: its colour scheme the reader's, its background, its width. What holds
 * the codebook decides these; an element inherits its host's colour scheme.
 */
const PAGE_STYLE = `
/* After STYLE: the root keeps the browser's text size, so rem is its, as anywhere. */
:root { color-scheme: light dark; font-size: 100%; }
body {
	font-size: 0.875rem;
	margin: 0 auto;
	max-inline-size: 1012px;
	padding: 1.5rem 1rem 4rem;
	background: var(--bgColor-default);
}
h1 { font-size: 2rem; font-weight: 600; line-height: 1.25; margin: 0 0 0.25rem; }
.count { color: var(--fgColor-muted); }
@media print {
	:root { color-scheme: light; }
	body { max-inline-size: none; padding: 0; }
}
`;

/**
 * Primer's look without fetching anything: its token values (Primer Primitives, light
 * and dark) as custom properties, each picked by `light-dark()` from the colour scheme
 * in use, and its system font stacks without the web font. A shared name is the green
 * the app gives one everywhere. Rooted at `:scope`: the document's root in a page, the
 * element in `<ddi-codebook>`'s `@scope`.
 */
export const STYLE = `
:scope {
	display: block;
	color: var(--fgColor-default);
	font: 400 0.875rem / 1.5 var(--fontStack-sansSerif);
	--fgColor-default: light-dark(#1f2328, #f0f6fc);
	--fgColor-muted: light-dark(#59636e, #9198a1);
	--fgColor-accent: light-dark(#0969da, #4493f8);
	--fgColor-shared: light-dark(#116329, #7ee787);
	--bgColor-default: light-dark(#ffffff, #0d1117);
	--bgColor-muted: light-dark(#f6f8fa, #151b23);
	--bgColor-accent-muted: light-dark(#ddf4ff, #388bfd1a);
	--bgColor-neutral-muted: light-dark(#818b981f, #656c7633);
	--borderColor-default: light-dark(#d1d9e0, #3d444d);
	--borderColor-muted: light-dark(#d1d9e0b3, #3d444db3);
	--borderColor-accent-emphasis: light-dark(#0969da, #1f6feb);
	--fontStack-sansSerif: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
	--fontStack-monospace: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
	--borderRadius-medium: 0.375rem;
	--borderRadius-small: 0.1875rem;
}
h2 { font-size: 1.25rem; font-weight: 600; margin: 2.5rem 0 1rem; padding-block-end: 0.5rem; border-block-end: 1px solid var(--borderColor-default); }
h3 { font-size: 1rem; font-weight: 600; margin: 0 0 0.5rem; }
h4 { font-size: 0.875rem; font-weight: 600; margin: 0 0 0.5rem; }
p { margin: 0 0 0.5rem; }
.from, .language, .urn, dt { color: var(--fgColor-muted); }
/* Underlined always, not only on hover as the app does: colour alone doesn't tell a link (WCAG 1.4.1). */
a { color: var(--fgColor-accent); text-decoration: underline; text-underline-position: under; }
:focus-visible { outline: 2px solid var(--borderColor-accent-emphasis); outline-offset: 2px; border-radius: var(--borderRadius-small); }
code { font: 0.9285em var(--fontStack-monospace); padding: 0.1em 0.3em; border-radius: var(--borderRadius-medium); background: var(--bgColor-neutral-muted); }
[data-urn] { font: 0.9285em var(--fontStack-monospace); }
a[data-urn] { color: var(--fgColor-shared); }
/* In an element, the contents come first: no space above them but the host's. */
:scope > nav > h2 { margin-block-start: 0; }
nav ol, nav ul { margin: 0; padding-inline-start: 1.25rem; }
nav > ul { list-style: none; padding-inline-start: 0; margin-block-start: 0.5rem; }
nav li { margin-block: 0.125rem; }
article, .group { padding-block: 1rem; border-block-start: 1px solid var(--borderColor-muted); scroll-margin-block-start: 1rem; }
section > h3 + article { border-block-start: 0; }
.group > article { padding-inline-start: 1rem; border-inline-start: 2px solid var(--borderColor-muted); }
/* The highlight reaches past the text by an outline of its own colour, so nothing moves. */
:target { background: var(--bgColor-accent-muted); outline: 0.5rem solid var(--bgColor-accent-muted); }
blockquote { margin: 0 0 0.5rem; padding-inline-start: 1rem; border-inline-start: 0.25em solid var(--borderColor-default); font-size: 1rem; }
.instruction, .answers, .option { color: var(--fgColor-muted); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0.75rem 0; }
dt { font-weight: 600; }
dd { margin: 0; }
dd p:last-child, dd ul { margin: 0; }
dd ul { padding-inline-start: 1.25rem; }
table { border-collapse: collapse; margin: 0.75rem 0; }
caption { text-align: start; font-weight: 600; padding-block-end: 0.25rem; }
caption .from { font-weight: 400; }
th, td { text-align: start; vertical-align: top; padding: 0.25rem 1rem 0.25rem 0; border-block-end: 1px solid var(--borderColor-muted); }
thead th { color: var(--fgColor-muted); font-weight: 600; }
tbody th { font-weight: 400; }
.missing th[scope="rowgroup"] { padding-block-start: 0.75rem; color: var(--fgColor-muted); font-weight: 600; }
footer dl { color: var(--fgColor-muted); }
@media print {
	nav { display: none; }
	h2, h3, h4 { break-after: avoid; }
	article { break-inside: avoid; }
	:target { background: none; outline: none; }
	a { color: inherit; }
}
`;
