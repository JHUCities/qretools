/**
 * A codebook as HTML: strings in, strings out, every one escaped where it is written.
 * Pure, as the model is: no DOM, so the page can be written by a command, a test or a
 * custom element alike.
 */

import {
	type Command,
	type Condition,
	type FlowCheck,
	type FlowInstrument,
	type FlowStep,
	itemKeyOf,
	type Part,
	type Source,
} from "@qretools/core";
import { type Asking, allStepsOf, type Linked } from "./flow.ts";
import type {
	Codebook,
	Described,
	Entry,
	Format,
	Listed,
	Row,
} from "./model.ts";
import { paragraphs, type Ref, type Span, type Text, textOf } from "./text.ts";
import { conditionsWords, isCondition, type Mode } from "./words.ts";

type AskStep = Extract<FlowStep, { kind: "ask" }>;

/** What a name in a condition or a text reads, as a reference to its entry or loop. */
const sourceRef = (s: Source): Ref => ({
	kind: "ref",
	type:
		s.kind === "compute"
			? "ComputationItem"
			: s.kind === "row"
				? "Loop"
				: "Variable",
	urn: s.urn,
	...(s.variable !== undefined && { name: s.variable }),
});

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
	/**
	 * Where each ask is in an instrument's map, by its construct's URN: its anchor, and the
	 * words of a link to it ("in the instrument", or naming the instrument when there are
	 * several). None where there's no map.
	 */
	readonly places?: ReadonlyMap<string, Place>;
	/** Each entry by its URN, and each select-all question's options by the question's. */
	readonly entries?: ReadonlyMap<string, Entry>;
	readonly options?: ReadonlyMap<string, readonly Entry[]>;
	/** The URNs of the variables that come with each case, which no question asks. */
	readonly inputs?: ReadonlySet<string>;
	/** Each ask to the entry recording its question, by its construct's URN. */
	readonly asks?: ReadonlyMap<string, Linked>;
	/** Each loop the map draws, by its URN, as a reference (named where it has a name). */
	readonly loops?: ReadonlyMap<string, Ref>;
}

interface Place {
	readonly anchor: string;
	readonly words: string;
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

function spanHtml(s: Span, cx: Context): string {
	const { anchors, inLink, href } = cx;
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
			const ref =
				to === undefined
					? `<span ${data}>${words}</span>`
					: `<a href="${escapeHtml(to)}" ${data}>${words}</a>`;
			return s.fill ? `<span class="ddi-fill">[${ref}]</span>` : ref;
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
	`<code>${escapeHtml(c.text)}</code>${c.language === undefined ? "" : ` <span class="ddi-language">(${escapeHtml(c.language)})</span>`}`;

/** What a name in a condition reads, as far as the page knows it. */
const lookupOf = (cx: Context) => (source: Source) => {
	const ref = sourceRef(source);
	if (source.kind !== "answer" && source.kind !== "input")
		// A row is never unanswered; a computed value may be.
		return { ref, known: { nullable: source.kind === "compute" } };
	const e = cx.entries?.get(source.urn);
	return {
		ref,
		...(e !== undefined && {
			known: {
				// An input, with no question, is set before the interview.
				nullable: e.question !== undefined,
				codes: (e.responses?.rows ?? []).filter((r) => !r.missing),
			},
		}),
	};
};

/** Conditions in words, or undefined where any can't be read (not VTL, say). */
const wordsHtml = (
	parts: readonly { readonly cond: Condition; readonly mode: Mode }[],
	cx: Context,
): string | undefined => {
	const said = conditionsWords(parts, lookupOf(cx));
	return said === undefined ? undefined : inlineHtml([said], cx);
};

/** One place a question is asked, as a phrase: its conditions, loops and orders. */
function askingHtml(a: Asking, cx: Context): string {
	const said = wordsHtml(
		a.conditions.map((c) => ({
			cond: c.cond,
			mode: c.negated ? "notTrue" : "true",
		})),
		cx,
	);
	const conditions =
		said !== undefined
			? [`if ${said}`]
			: a.conditions.map(
					(c) =>
						`${c.negated ? "unless" : "if"} ${commandHtml(c.cond.command)}`,
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

/** A link from an asking to its place in the instrument's map, if the page has it. */
function placeHtml(a: Asking, cx: Context): string {
	const place = cx.places?.get(a.construct);
	return place === undefined
		? ""
		: ` <a href="${hrefOf(place.anchor)}">${place.words}</a>`;
}

/**
 * Where a question is asked, each place linked to the instrument's map. Nothing when it is
 * asked once, with no condition, loop or order, and no map to link to.
 */
function askedHtml(asked: readonly Asking[], cx: Context): string | undefined {
	// After a condition, a semicolon: "or not answered in the instrument" would change its meaning.
	const places = asked.map((a) => {
		const said = askingHtml(a, cx);
		const place = placeHtml(a, cx);
		return said === "Always" || place === ""
			? `${said}${place}`
			: `${said};${place}`;
	});
	if (places.length === 0 || (places.length === 1 && places[0] === "Always"))
		return undefined;
	return places.length === 1
		? places[0]
		: `<ul>${places.map((p) => `<li>${p}</li>`).join("")}</ul>`;
}

/** A number's or a text's format in words, as a codebook says it. */
export function formatWords(f: Format): string {
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
	const unit = f.unit === undefined ? "" : `, in ${f.unit}`;
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
	const caption = `${valid.length === 0 ? "Missing values" : "Values"}${from === "" ? "" : ` <span class="ddi-from">from ${from}</span>`}`;
	const body = (rs: readonly Row[]) => rs.map((r) => rowHtml(r, cx)).join("");
	return `<table><caption${cx.en}>${caption}</caption><thead${cx.en}><tr><th scope="col">Code</th><th scope="col">Label</th></tr></thead>${
		valid.length === 0
			? `<tbody>${body(missing)}</tbody>`
			: `<tbody>${body(valid)}</tbody>${
					missing.length === 0
						? ""
						: `<tbody class="ddi-missing"><tr><th scope="rowgroup" colspan="2"${cx.en}>Missing values</th></tr>${body(missing)}</tbody>`
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
		.join(" ") || `<span class="ddi-urn">${escapeHtml(urn)}</span>`;

/**
 * An item's heading, then a link to it to copy and share, as a markdown heading has;
 * no link without an anchor. Outside the heading, so the heading's name stays its words.
 */
function headingHtml(
	level: 3 | 4,
	name: string | undefined,
	label: Text | undefined,
	urn: string,
	cx: Context,
): string {
	const heading = `<h${level}>${titleHtml(name, label, urn, cx)}</h${level}>`;
	const anchor = anchorOf(urn);
	return anchor === undefined
		? heading
		: `<div class="ddi-heading">${heading}<a class="ddi-anchor" href="${hrefOf(anchor)}"><span aria-hidden="true">#</span><span class="ddi-visually-hidden">${english("Link to", cx)} ${titleHtml(name, label, urn, { ...cx, inLink: true })}</span></a></div>`;
}

/** A question's words: its text as quoted, then what the interviewer is told. */
const questionHtml = (q: NonNullable<Entry["question"]>, cx: Context): string =>
	`${q.text === undefined ? "" : `<blockquote>${blockHtml(q.text, cx)}</blockquote>`}${q.instructions
		.map((i) => `<div class="ddi-instruction">${blockHtml(i, cx)}</div>`)
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
		pair(
			cx,
			"Asked",
			cx.inputs?.has(e.urn)
				? "Not asked: comes with each case"
				: askedHtml(e.asked, cx),
			true,
		),
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
			e.format === undefined ? undefined : escapeHtml(formatWords(e.format)),
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
								`<code>${escapeHtml(i.value)}</code>${i.type === undefined ? "" : ` <span class="ddi-language">(${escapeHtml(i.type)})</span>`}`,
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
			: `<p class="ddi-option">${english("Option", cx)} <code>${escapeHtml(e.group.option.code)}</code>${e.group.option.label === undefined ? "" : ` ${inlineHtml(e.group.option.label, cx)}`}</p>`;
	const question =
		e.question === undefined || e.group !== undefined
			? ""
			: questionHtml(e.question, cx);
	// Only lists with a name: a URN in a caption says nothing a reader can use.
	const from = refsHtml(
		(e.responses?.from ?? []).filter((r) => r.name !== undefined),
		cx,
	);
	return `<article${idAttr(e.urn)}>${headingHtml(level, e.name, e.label, e.urn, cx)}${option}${question}${particulars}${tableHtml(rows, from, cx)}${more === "" ? "" : `<footer>${more}</footer>`}</article>`;
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

export function blocksOf(entries: readonly Entry[]): Block[] {
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
	return `<section${idAttr(q.urn)} class="ddi-group">${headingHtml(3, q.name, undefined, q.urn, cx)}${questionHtml(q, cx)}<p class="ddi-answers"${cx.en}>Select all that apply, each option a variable of its own</p>${b.options.map((o) => entryHtml(o, 4, cx)).join("")}</section>`;
}

/** A shared item: its name and label, its description or its codes. */
const sharedHtml = (it: Described | Listed, cx: Context): string =>
	`<article${idAttr(it.urn)}>${headingHtml(4, it.name, it.label, it.urn, cx)}${
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
	// The page's order: the instrument's map comes before the variables.
	const instrument =
		cb.instruments.length === 0
			? ""
			: `<ul${cx.en}><li><a href="#ddi-instrument">${cb.instruments.length === 1 ? "Instrument" : "Instruments"}</a></li></ul>`;
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
	return `<nav aria-labelledby="ddi-contents"><h2 id="ddi-contents"${cx.en}>Contents</h2>${instrument}<ol>${entries.join("")}</ol>${rest === "" ? "" : `<ul${cx.en}>${rest}</ul>`}</nav>`;
}

/** The anchors a codebook's HTML has: its entries', its select-all questions' and its shared items'. */
const anchorsOf = (cb: Codebook, blocks: readonly Block[]): Set<string> =>
	new Set(
		[
			...cb.entries.map((e) => e.urn),
			...blocks.flatMap((b) => (b.kind === "group" ? [b.question.urn] : [])),
			...SHARED.flatMap((s) => cb.shared[s.key].map((it) => it.urn)),
			...cb.instruments.map((i) => i.urn),
			// A loop, so a fill of its counter can link to it.
			...cb.instruments.flatMap((i) =>
				allStepsOf(i.flow).flatMap((s) =>
					s.kind === "count" || s.kind === "repeat" || s.kind === "loop"
						? [s.urn]
						: [],
				),
			),
		].flatMap((urn) => {
			const anchor = anchorOf(urn);
			return anchor === undefined ? [] : [anchor];
		}),
	);

/** The asks in a tree of steps, in order. */
const asksOf = (steps: readonly FlowStep[]): AskStep[] =>
	allStepsOf(steps).filter((s): s is AskStep => s.kind === "ask");

/**
 * Each ask's place in the map: its construct's anchor, on the first place it appears only
 * (a construct reached by two paths is drawn twice, and an id is once a page).
 */
function placesOf(
	instruments: readonly FlowInstrument[],
	en: string,
): Map<string, Place> {
	const places = new Map<string, Place>();
	const words = (s: string) => (en === "" ? s : `<span${en}>${s}</span>`);
	for (const i of instruments)
		for (const ask of asksOf(i.flow)) {
			const anchor = anchorOf(ask.urn);
			if (anchor === undefined || places.has(ask.urn)) continue;
			places.set(ask.urn, {
				anchor,
				words:
					instruments.length === 1 || i.name === undefined
						? words("in the instrument")
						: `${words("in")} <code>${escapeHtml(i.name)}</code>`,
			});
		}
	return places;
}

/** How far a drawing has got: the constructs that have their id, and the asks numbered. */
interface Drawing {
	readonly drawn: Set<string>;
	asked: number;
}

/** Steps as a list; nothing for none. */
const flowHtml = (
	steps: readonly FlowStep[],
	cx: Context,
	at: Drawing,
	depth: number,
): string =>
	steps.length === 0
		? ""
		: // role: a list styled without markers stays a list to VoiceOver.
			`<ol class="ddi-flow" role="list">${steps.map((s) => stepHtml(s, cx, at, depth)).join("")}</ol>`;

/** A condition as written, its program language after it. */
const conditionHtml = (c: Condition): string => commandHtml(c.command);

/** A value (a roster's count): the name it reads, else as written. */
const valueHtml = (c: Condition, cx: Context): string => {
	const source =
		c.kind === "parsed" && c.expr.kind === "name"
			? c.sources.get(c.expr.name)
			: undefined;
	return source === undefined
		? conditionHtml(c)
		: inlineHtml([[sourceRef(source)]], cx);
};

/** The page's word for a step, and its words: `<strong>`, as a paper questionnaire's. */
const lead = (word: string, cx: Context): string =>
	`<strong${cx.en}>${word}</strong>`;

/** Displayed text as the reader gives it: words, and each value piped in as a fill. */
const partsText = (parts: readonly Part[]): Text =>
	paragraphs(
		parts.map(
			(p): Span =>
				p.kind === "text"
					? { kind: "text", text: p.text }
					: { ...sourceRef(p.source), fill: true },
		),
	);

/** How an ask is answered: its options and their codes (missing ones left out), or its format. */
function answersHtml(s: AskStep, cx: Context): string {
	const key = cx.asks?.get(s.urn)?.urn;
	const options = key === undefined ? undefined : cx.options?.get(key);
	const entry = key === undefined ? undefined : cx.entries?.get(key);
	const rows: readonly { code: string; label?: Text }[] =
		options !== undefined
			? options.flatMap((o) => (o.group === undefined ? [] : [o.group.option]))
			: (entry?.responses?.rows ?? []).filter((r) => !r.missing);
	const many = options !== undefined || entry?.responses?.many === true;
	return `${many ? `<p class="ddi-answers"${cx.en}>Select all that apply</p>` : ""}${
		rows.length === 0
			? ""
			: `<ul class="ddi-options" role="list">${rows
					.map(
						(r) =>
							`<li><code>${escapeHtml(r.code)}</code><span>${r.label === undefined ? "" : inlineHtml(r.label, cx)}</span></li>`,
					)
					.join("")}</ul>`
	}${entry?.format === undefined ? "" : `<p class="ddi-answers"${cx.en}>${escapeHtml(formatWords(entry.format))}</p>`}`;
}

/** An if's branches, each under "Ask if" and its condition in words: an else-if's and an else's say the earlier branches didn't hold. */
function branchHtml(
	s: {
		readonly type?: string;
		readonly branches: readonly {
			readonly cond: Condition;
			readonly then: readonly FlowStep[];
		}[];
		readonly else?: readonly FlowStep[];
	},
	cx: Context,
	at: Drawing,
	depth: number,
): string {
	const type =
		s.type === undefined
			? ""
			: ` <span class="ddi-language">(${escapeHtml(s.type)})</span>`;
	const before = (n: number): { cond: Condition; mode: Mode }[] =>
		s.branches.slice(0, n).map((b) => ({ cond: b.cond, mode: "notTrue" }));
	// "Show if" over text alone: nothing there is asked.
	const verb = (steps: readonly FlowStep[]) =>
		steps.every((x) => x.kind === "say") ? "Show if" : "Ask if";
	const arm = (
		steps: readonly FlowStep[],
		said: string | undefined,
		written: string,
		first = false,
	) =>
		`<div class="ddi-arm"><p class="ddi-if">${
			said === undefined ? written : `${lead(verb(steps), cx)} ${said}`
		}${first ? type : ""}</p>${flowHtml(steps, cx, at, depth)}</div>`;
	const arms = s.branches.map((b, i) =>
		arm(
			b.then,
			wordsHtml([...before(i), { cond: b.cond, mode: "true" }], cx),
			`${english(i === 0 ? "If" : "Else if", cx)} ${conditionHtml(b.cond)}`,
			i === 0,
		),
	);
	const otherwise =
		s.else === undefined
			? ""
			: arm(
					s.else,
					wordsHtml(before(s.branches.length), cx),
					english("Else", cx),
				);
	return `<li>${arms.join("")}${otherwise}</li>`;
}

/** A check after its ask: when its message shows, and the message. */
const checkHtml = (c: FlowCheck, cx: Context): string => {
	const said = wordsHtml([{ cond: c.ensure, mode: "false" }], cx);
	return `<div class="ddi-arm"><p class="ddi-if">${
		said === undefined
			? `${english("Unless", cx)} ${conditionHtml(c.ensure)}`
			: `${lead("Show if", cx)} ${said}`
	} <span class="ddi-language">(${escapeHtml(c.severity)})</span></p>${
		c.message === undefined
			? ""
			: `<ol class="ddi-flow" role="list"><li><blockquote>${blockHtml(partsText(c.message), cx)}</blockquote></li></ol>`
	}</div>`;
};

/** A loop's or a roster's line, with its id once (a loop reached by two paths is drawn twice). */
const loopHtml = (
	s: Extract<FlowStep, { kind: "count" | "repeat" | "loop" }>,
	how: string,
	cx: Context,
	at: Drawing,
	depth: number,
): string => {
	const it = cx.loops?.get(s.urn);
	// An unnamed loop isn't named by its URN: "Repeated while …" says enough.
	const named = it?.name === undefined ? "" : ` ${inlineHtml([[it]], cx)}`;
	const id = at.drawn.has(s.urn) ? "" : idAttr(s.urn);
	at.drawn.add(s.urn);
	return `<li${id}><p>${lead("Repeated", cx)}${named}${how}</p>${flowHtml(s.flow, cx, at, depth)}</li>`;
};

/** One step as a list item. */
function stepHtml(
	s: FlowStep,
	cx: Context,
	at: Drawing,
	depth: number,
): string {
	switch (s.kind) {
		case "ask": {
			const place = cx.places?.get(s.urn);
			const id =
				place === undefined || at.drawn.has(s.urn)
					? ""
					: ` id="${escapeHtml(place.anchor)}"`;
			at.drawn.add(s.urn);
			// Numbered at each place it's asked: a construct reached twice is asked twice.
			at.asked++;
			const entry = cx.asks?.get(s.urn);
			const to = entry === undefined ? undefined : anchorOf(entry.urn);
			const name =
				entry === undefined
					? escapeHtml(s.question.name)
					: to !== undefined && cx.anchors.has(to)
						? contentsLink(entry.urn, entry.name, undefined, cx)
						: titleHtml(entry.name, undefined, entry.urn, cx);
			const question =
				entry === undefined
					? undefined
					: (cx.entries?.get(entry.urn)?.question ??
						cx.options?.get(entry.urn)?.[0]?.question);
			const order =
				s.responseOrder === undefined
					? ""
					: `<p class="ddi-answers"><span${cx.en}>Options in order:</span> ${escapeHtml(s.responseOrder)}</p>`;
			const text = partsText(s.text);
			return `<li${id} class="ddi-ask"><p class="ddi-ask-name"><span class="ddi-number">${at.asked}.</span> ${name}</p>${questionHtml(
				{
					urn: s.question.urn,
					...(text.length > 0 && { text }),
					instructions: question?.instructions ?? [],
				},
				cx,
			)}${order}${answersHtml(s, cx)}${s.checks.map((c) => checkHtml(c, cx)).join("")}</li>`;
		}
		case "say": {
			const text = partsText(s.text);
			return `<li>${
				text.length === 0
					? english("A statement with no text", cx)
					: `<blockquote>${blockHtml(text, cx)}</blockquote>`
			}</li>`;
		}
		case "compute": {
			const assigns = inlineHtml(
				[
					[
						{
							kind: "ref",
							type: "ComputationItem",
							urn: s.urn,
							name: s.variable,
						},
					],
				],
				cx,
			);
			// A condition: "x is true when …"; a value: "x is set to `…`".
			const said = isCondition(s.value)
				? wordsHtml([{ cond: s.value, mode: "true" }], cx)
				: undefined;
			return `<li><p>${lead("Computed", cx)} ${assigns} ${
				said === undefined
					? `${english("is set to", cx)} ${conditionHtml(s.value)}`
					: `${english("is true when", cx)} ${said}`
			}</p></li>`;
		}
		case "if":
			return branchHtml(s, cx, at, depth);
		case "stop":
			return branchHtml(
				{
					type: "stop",
					// biome-ignore lint/suspicious/noThenProperty: the reader's field, never awaited
					branches: [{ cond: s.cond, then: s.say }],
					else: s.else,
				},
				cx,
				at,
				depth,
			);
		case "count":
			return loopHtml(
				s,
				`${s.row === undefined ? "" : ` ${english("for", cx)} <code>${escapeHtml(s.row)}</code> = 1, 2, 3 …`} ${english("up to", cx)} ${valueHtml(s.count, cx)}${s.max === undefined ? "" : english(`, at most ${s.max}`, cx)}`,
				cx,
				at,
				depth,
			);
		case "repeat": {
			const said = wordsHtml([{ cond: s.more, mode: "true" }], cx);
			return loopHtml(
				s,
				` ${english("while", cx)} ${said ?? conditionHtml(s.more)}${english(`, at most ${s.max} times`, cx)}`,
				cx,
				at,
				depth,
			);
		}
		case "loop": {
			const said = wordsHtml([{ cond: s.cond, mode: "true" }], cx);
			return loopHtml(
				s,
				` ${english(s.construct === "RepeatUntil" ? "until" : "while", cx)} ${said ?? conditionHtml(s.cond)}`,
				cx,
				at,
				depth,
			);
		}
		case "section": {
			// A section's name is its title (QREtools writes it there), so words, not code.
			const title =
				s.label !== undefined
					? escapeHtml(s.label)
					: s.name !== undefined
						? escapeHtml(s.name)
						: english("Section", cx);
			const order =
				s.order === undefined
					? ""
					: ` <span class="ddi-language">(${escapeHtml(s.order)})</span>`;
			// Under the instrument's h3: h4, then deeper, as far as HTML goes.
			const h = `h${Math.min(4 + depth, 6)}`;
			return `<li><${h} class="ddi-section">${title}${order}</${h}>${flowHtml(s.flow, cx, at, depth + 1)}</li>`;
		}
		default:
			return s satisfies never;
	}
}

/** What comes with each case: each input's name, its values, then what it says of itself. */
function inputsHtml(inputs: readonly Entry[], cx: Context): string {
	if (inputs.length === 0) return "";
	const one = (e: Entry) => {
		const labels = (e.responses?.rows ?? [])
			.filter((r) => !r.missing && r.label !== undefined)
			.map((r) => inlineHtml(r.label ?? [], cx));
		const name = contentsLink(e.urn, e.name, undefined, cx);
		return `<p>${lead("Comes with each case:", cx)} ${name}${labels.length === 0 ? "" : ` (${labels.join(", ")})`}.${e.notes === undefined ? "" : ` ${inlineHtml(e.notes, cx)}`}</p>`;
	};
	return inputs.map(one).join("");
}

/**
 * Each instrument as its specification, a paper questionnaire's: its title, what it is,
 * then its steps in order, each question numbered with its words and its answers, and
 * each condition in words where it is VTL.
 */
function instrumentsHtml(cb: Codebook, cx: Context): string {
	if (cb.instruments.length === 0) return "";
	const drawn = new Set<string>();
	return `<section aria-labelledby="ddi-instrument"><h2 id="ddi-instrument"${cx.en}>${cb.instruments.length === 1 ? "Instrument" : "Instruments"}</h2>${cb.instruments
		.map(
			(i) =>
				`<article${idAttr(i.urn)}>${headingHtml(3, i.name, textOf(i.label), i.urn, cx)}${
					i.description === undefined
						? ""
						: blockHtml(textOf(i.description) ?? [], cx)
				}${inputsHtml(i.inputs, cx)}${flowHtml(i.flow, cx, { drawn, asked: 0 }, 0)}</article>`,
		)
		.join("")}</section>`;
}

/** Each entry by its URN, and by its question's where a condition's name reads the question. */
function entriesOf(entries: readonly Entry[]): Map<string, Entry> {
	const byUrn = new Map(entries.map((e) => [e.urn, e]));
	for (const e of entries)
		if (
			e.question !== undefined &&
			e.group === undefined &&
			!byUrn.has(e.question.urn)
		)
			byUrn.set(e.question.urn, e);
	return byUrn;
}

/** Each select-all question's options, by the question's newest URN, as its asks name it. */
function optionsOf(entries: readonly Entry[]): Map<string, Entry[]> {
	const options = new Map<string, Entry[]>();
	for (const e of entries)
		if (e.group !== undefined)
			options.set(e.group.question, [
				...(options.get(e.group.question) ?? []),
				e,
			]);
	return options;
}

/**
 * A codebook as HTML to place in a page. In order: the contents, each entry, the shared
 * items they refer to, and any reference that leads nowhere, each part under an `<h2>`.
 * No landmark but the contents' `<nav>`, no `<h1>`, no style: what holds it (`pageOf`,
 * `<ddi-codebook>`) says what it is part of. The document's text is in the language it
 * was read in, which the holder declares. The codebook's own words are English, marked so
 * unless that language is English.
 */
export function codebookHtml(cb: Codebook, options: Options = {}): string {
	const blocks = blocksOf(cb.entries);
	const english = cb.lang !== undefined && /^en(-|$)/i.test(cb.lang);
	const en = english ? "" : ' lang="en"';
	const cx: Context = {
		...options,
		anchors: anchorsOf(cb, blocks),
		en,
		places: placesOf(cb.instruments, en),
		asks: cb.asks,
		loops: cb.loops,
		entries: entriesOf(cb.entries),
		options: optionsOf(cb.entries),
		inputs: new Set(cb.instruments.flatMap((i) => i.inputs.map((e) => e.urn))),
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
${instrumentsHtml(cb, cx)}
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
<header><h1>${escapeHtml(title)}</h1><p class="ddi-count"${english ? "" : ' lang="en"'}>${counted}</p></header>
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
.ddi-count { color: var(--fgColor-muted); }
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
.ddi-heading { display: flex; align-items: baseline; gap: 0.5rem; margin: 0 0 0.5rem; }
.ddi-heading > :is(h3, h4) { margin: 0; }
/* Shown where it can be used: on hover or focus, and always where nothing hovers. A lone "#", not words in a line, so no underline. */
.ddi-anchor { color: var(--fgColor-muted); text-decoration: none; opacity: 0; }
.ddi-heading:is(:hover, :focus-within) .ddi-anchor { opacity: 1; }
@media (hover: none) { .ddi-anchor { opacity: 1; } }
.ddi-visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.ddi-from, .ddi-language, .ddi-urn, dt { color: var(--fgColor-muted); }
/* Underlined always, not only on hover as the app does: colour alone doesn't tell a link (WCAG 1.4.1). */
a { color: var(--fgColor-accent); text-decoration: underline; text-underline-position: under; }
:focus-visible { outline: 2px solid var(--borderColor-accent-emphasis); outline-offset: 2px; border-radius: var(--borderRadius-small); }
code { font: 0.9285em var(--fontStack-monospace); padding: 0.1em 0.3em; border-radius: var(--borderRadius-medium); background: var(--bgColor-neutral-muted); }
/* A reference with no name shows its URN, one long word: it may break anywhere. */
[data-urn] { font: 0.9285em var(--fontStack-monospace); overflow-wrap: anywhere; }
a[data-urn] { color: var(--fgColor-shared); }
/* In an element, the contents come first: no space above them but the host's. */
:scope > nav > h2 { margin-block-start: 0; }
nav ol, nav ul { margin: 0; padding-inline-start: 1.25rem; }
nav > ul { list-style: none; padding-inline-start: 0; margin-block-start: 0.5rem; }
nav li { margin-block: 0.125rem; }
article, .ddi-group { padding-block: 1rem; border-block-start: 1px solid var(--borderColor-muted); scroll-margin-block-start: 1rem; }
section > h3 + article { border-block-start: 0; }
.ddi-group > article { padding-inline-start: 1rem; border-inline-start: 2px solid var(--borderColor-muted); }
/* The highlight reaches past the text by an outline of its own colour, so nothing moves. */
:target { background: var(--bgColor-accent-muted); outline: 0.5rem solid var(--bgColor-accent-muted); }
blockquote { margin: 0 0 0.5rem; padding-inline-start: 1rem; border-inline-start: 0.25em solid var(--borderColor-default); font-size: 1rem; }
.ddi-instruction, .ddi-answers, .ddi-option { color: var(--fgColor-muted); }
/* The instrument's map: nesting shown by indentation and a rule, not numbers. */
.ddi-flow { list-style: none; margin: 0.25rem 0 0.5rem; padding-inline-start: 0; }
.ddi-flow .ddi-flow { padding-inline-start: 1rem; border-inline-start: 2px solid var(--borderColor-muted); }
.ddi-flow li { margin-block: 0.25rem; scroll-margin-block-start: 1rem; }
.ddi-flow p, .ddi-flow blockquote { margin: 0; }
/* The specification: each question numbered, its words, its answers; a condition over what it decides. */
.ddi-flow .ddi-ask { margin-block: 0.75rem; break-inside: avoid; }
.ddi-flow .ddi-ask > :is(p, blockquote, ul) { margin-block-end: 0.25rem; }
.ddi-ask-name { font-weight: 600; }
.ddi-number { display: inline-block; min-inline-size: 2em; }
.ddi-options { list-style: none; margin: 0; padding-inline-start: 2em; display: grid; grid-template-columns: max-content 1fr; gap: 0 0.75rem; }
/* Each option a row of the list's grid, so every code takes the widest code's room and stays a list item. */
.ddi-options li { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; }
.ddi-options code { justify-self: start; overflow-wrap: anywhere; }
.ddi-arm { margin-block: 0.5rem; }
.ddi-if { padding: 0.25rem 0.5rem; border-radius: var(--borderRadius-medium); background: var(--bgColor-accent-muted); }
.ddi-flow :is(h4, h5, h6) { margin: 1rem 0 0.25rem; }
/* A long command wraps rather than scrolling the page sideways. */
:is(.ddi-flow, dd) code { white-space: pre-wrap; overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0.75rem 0; }
dt { font-weight: 600; }
dd { margin: 0; }
dd p:last-child, dd ul { margin: 0; }
dd ul { padding-inline-start: 1.25rem; }
table { border-collapse: collapse; margin: 0.75rem 0; }
caption { text-align: start; font-weight: 600; padding-block-end: 0.25rem; }
caption .ddi-from { font-weight: 400; }
th, td { text-align: start; vertical-align: top; padding: 0.25rem 1rem 0.25rem 0; border-block-end: 1px solid var(--borderColor-muted); }
thead th { color: var(--fgColor-muted); font-weight: 600; }
tbody th { font-weight: 400; }
.ddi-missing th[scope="rowgroup"] { padding-block-start: 0.75rem; color: var(--fgColor-muted); font-weight: 600; }
footer dl { color: var(--fgColor-muted); }
@media print {
	nav { display: none; }
	.ddi-anchor { display: none; }
	h2, h3, h4, h5, h6, .ddi-heading, .ddi-if { break-after: avoid; }
	article { break-inside: avoid; }
	/* An instrument runs over many pages: only its questions keep together. */
	section > article:has(.ddi-flow) { break-inside: auto; }
	.ddi-if { background: none; border: 1px solid; }
	:target { background: none; outline: none; }
	a { color: inherit; }
}
`;
