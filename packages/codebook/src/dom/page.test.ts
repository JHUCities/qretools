// @vitest-environment jsdom
/** A codebook's page read back by a real parser: its structure, its anchors and its links. */
import { describe, expect, it } from "vitest";
import { anchorOf, codebookHtml, hrefOf, pageOf } from "../html.ts";
import type { Codebook, Entry } from "../model.ts";
import bankPage from "../node/__snapshots__/bank.html?raw";
import type { Text } from "../text.ts";

const t = (s: string): Text => [[{ kind: "text", text: s }]];
const urn = (id: string, version = "1") => `urn:ddi:org.x:${id}:${version}`;
const MISSING = [{ code: "-9", label: t("Don't know"), missing: true }];

const entry = (id: string, more: Partial<Entry> = {}): Entry => ({
	urn: urn(id),
	type: "Variable",
	name: id,
	universes: [],
	concepts: [],
	asked: [],
	...more,
});

const option = (id: string, code: string): Entry =>
	entry(id, {
		question: { urn: urn("pets"), name: "pets", instructions: [] },
		group: { question: urn("pets"), option: { code, label: t(id) } },
		responses: { many: false, rows: [], from: [] },
	});

/** Options of one question apart, a reference to an older version, a number with only missing values. */
const CODEBOOK: Codebook = {
	lang: "fr",
	title: "Pets & <people>",
	entries: [
		option("dog", "1"),
		entry("age", {
			label: t("Age"),
			question: {
				urn: urn("age-q"),
				name: "age_q",
				text: [
					[{ kind: "text", text: "How old are you?" }],
					[{ kind: "link", text: "https://a.org", url: "https://a.org" }],
				],
				instructions: [t("Read aloud.")],
			},
			responses: { many: false, rows: MISSING, from: [] },
			format: { kind: "number", min: 0, max: 120, unit: "years" },
			universes: [
				{
					kind: "ref",
					type: "Universe",
					urn: urn("adults", "3"),
					name: "adults",
				},
			],
			asked: [
				{
					construct: urn("ask-age"),
					conditions: [
						{ command: "consent = 2", language: "VTL", negated: true },
						{ command: "adult", negated: false },
					],
					loops: [
						{ kind: "ref", type: "Loop", urn: urn("people"), name: "people" },
					],
					order: "Random",
				},
			],
		}),
		option("cat", "2"),
		entry("tenure", {
			responses: {
				many: false,
				rows: [{ code: "1", label: t("Own"), missing: false }, ...MISSING],
				from: [
					{
						kind: "ref",
						type: "CodeList",
						urn: urn("tenure.codes"),
						name: "tenure.codes",
					},
				],
			},
		}),
	],
	shared: {
		concepts: [],
		universes: [
			{
				urn: urn("adults", "4"),
				name: "adults",
				description: t("People 18 or over."),
			},
		],
		codeLists: [
			{
				urn: urn("tenure.codes"),
				name: "tenure.codes",
				rows: [{ code: "1", label: t("Own"), missing: false }],
			},
		],
		missing: [],
	},
	findings: [
		{
			code: "codebook-dangling",
			severity: "error",
			path: urn("age"),
			message: "`urn:ddi:org.x:nothing:1` isn't in the document.",
		},
	],
};

const read = (html: string): Document =>
	new DOMParser().parseFromString(html, "text/html");

/**
 * The element a fragment indicates, as HTML's "find a potential indicated element" says: the
 * fragment as written, else percent-decoded. jsdom's `:target` neither decodes nor updates
 * after the first fragment, so the browser's rule is followed here instead.
 */
const indicated = (page: Document, href: string): Element | null => {
	const fragment = href.slice(1);
	return (
		page.getElementById(fragment) ??
		page.getElementById(decodeURIComponent(fragment))
	);
};

/** Every id once, and every link to the page finds its id. */
function linksHold(page: Document): void {
	const ids = [...page.querySelectorAll("[id]")].map((e) => e.id);
	expect(new Set(ids).size).toBe(ids.length);
	for (const a of page.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))
		expect(
			indicated(page, a.getAttribute("href") ?? ""),
			a.outerHTML,
		).not.toBeNull();
}

/** Nothing fetched, nothing run. */
function selfContained(page: Document): void {
	expect(
		page.querySelectorAll("script, link[rel=stylesheet], img, iframe"),
	).toHaveLength(0);
	expect(page.querySelector("link[rel=icon]")?.getAttribute("href")).toBe(
		"data:,",
	);
	for (const a of page.querySelectorAll("a[href]:not([href^='#'])"))
		expect(a.getAttribute("rel")).toBe("external");
	// The document's own words may say "url(": only the style could fetch with it.
	for (const style of page.querySelectorAll("style"))
		expect(style.textContent).not.toMatch(/@import|url\(/);
	for (const e of page.querySelectorAll("*"))
		for (const a of e.attributes)
			expect(a.name.startsWith("on"), `${e.tagName} ${a.name}`).toBe(false);
}

describe("a codebook's page", () => {
	const html = pageOf(CODEBOOK);
	const page = read(html);

	it("is one page, nothing fetched, every anchor once and every link found", () => {
		selfContained(page);
		linksHold(page);
		expect(page.title).toBe("Pets & <people>");
		for (const one of ["main", "h1", "header"])
			expect(page.querySelectorAll(one)).toHaveLength(1);
	});

	it("is in the codebook's language, its own words marked English", () => {
		expect(page.documentElement.lang).toBe("fr");
		for (const english of page.querySelectorAll(
			"#ddi-contents, #ddi-variables, header p, dt, caption, thead",
		))
			expect(english.closest("[lang]")?.getAttribute("lang")).toBe("en");
		// What the document says is in its own language.
		expect(
			page
				.querySelector("#org\\.x\\:age blockquote")
				?.closest("[lang]")
				?.getAttribute("lang"),
		).toBe("fr");
		const { lang: _, ...unknown } = CODEBOOK;
		expect(read(pageOf(unknown)).documentElement.hasAttribute("lang")).toBe(
			false,
		);
		const english = read(pageOf({ ...CODEBOOK, lang: "en-GB" }));
		expect(english.querySelectorAll("body [lang]")).toHaveLength(0);
	});

	it("links to the anchor a browser finds, its key percent-encoded but for colons", () => {
		const cb = {
			...CODEBOOK,
			entries: [entry("a@b"), entry("é", { label: t("See a@b") })],
		};
		const at = read(pageOf(cb));
		expect(
			[...at.querySelectorAll('nav a[href^="#org"]')].map((a) =>
				a.getAttribute("href"),
			),
		).toEqual(["#org.x:a%40b", "#org.x:%C3%A9"]);
		linksHold(at);
	});

	it("names, never links, a key holding half a character", () => {
		const half = "a\uD800";
		expect(anchorOf(urn(half))).toBeUndefined();
		expect(hrefOf(half)).toBe("#a%EF%BF%BD");
		const at = read(pageOf({ ...CODEBOOK, entries: [entry(half)] }));
		expect(at.querySelector("article")?.hasAttribute("id")).toBe(false);
		linksHold(at);
	});

	it("keeps a select-all question's options together whichever version each cites", () => {
		const cites = (id: string, code: string, version: string): Entry => ({
			...option(id, code),
			group: { question: urn("pets", version), option: { code, label: t(id) } },
		});
		const at = read(
			pageOf({
				...CODEBOOK,
				entries: [cites("dog", "1", "1"), cites("cat", "2", "2")],
			}),
		);
		expect(at.querySelectorAll("section.group")).toHaveLength(1);
		expect(at.querySelectorAll("section.group article")).toHaveLength(2);
		linksHold(at);
	});

	it("lists a select-all question's options together, where its first is", () => {
		const blocks = [...page.querySelectorAll("#ddi-variables ~ *")].map(
			(e) => e.querySelector("h3")?.textContent,
		);
		expect(blocks).toEqual(["pets", "age Age", "tenure"]);
		const group = page.getElementById("org.x:pets");
		expect(
			[...(group?.querySelectorAll("article h4") ?? [])].map(
				(h) => h.textContent,
			),
		).toEqual(["dog", "cat"]);
		expect(page.querySelectorAll("nav > ol ol li")).toHaveLength(2);
	});

	it("links a reference to an older version of an item to its one anchor", () => {
		const universe = page.querySelector<HTMLAnchorElement>(
			'#org\\.x\\:age a[data-kind="Universe"]',
		);
		expect(universe?.getAttribute("href")).toBe("#org.x:adults");
		expect(universe?.dataset.urn).toBe(urn("adults", "3"));
		const loop = page.querySelector('#org\\.x\\:age [data-kind="Loop"]');
		expect(loop?.tagName).toBe("SPAN");
	});

	it("writes each entry's particulars as terms, and where it is asked plainly", () => {
		const age = page.getElementById("org.x:age");
		const terms = Object.fromEntries(
			[...(age?.querySelectorAll("dt") ?? [])].map((dt) => [
				dt.textContent,
				dt.nextElementSibling?.textContent,
			]),
		);
		expect(terms).toEqual({
			Universe: "adults",
			Asked:
				"Unless consent = 2 (VTL) and if adult; repeated in people; section order: Random",
			Format: "Number from 0 to 120, in years",
		});
		expect(age?.querySelector("blockquote")?.children).toHaveLength(2);
		expect(age?.querySelector(".instruction")?.textContent).toBe("Read aloud.");
	});

	it("puts missing codes after valid ones, a table of missing values alone captioned so", () => {
		const tenure = page.getElementById("org.x:tenure")?.querySelector("table");
		expect(tenure?.caption?.textContent).toBe("Values from tenure.codes");
		expect(
			[...(tenure?.tBodies ?? [])].map((b) =>
				[...b.rows].map((r) => r.textContent),
			),
		).toEqual([["1Own"], ["Missing values", "-9Don't know"]]);
		expect(tenure?.querySelector('th[scope="row"]')?.textContent).toBe("1");
		expect(
			page.querySelector("#org\\.x\\:tenure dt:last-of-type + dd")?.textContent,
		).toBe("-9");
		const age = page.getElementById("org.x:age")?.querySelector("table");
		expect(age?.caption?.textContent).toBe("Missing values");
		expect(age?.tBodies).toHaveLength(1);
	});

	it("lists shared items and broken references in sections of their own", () => {
		expect(
			[...page.querySelectorAll("#ddi-shared ~ section h3")].map(
				(h) => h.textContent,
			),
		).toEqual(["Universes", "Code lists"]);
		expect(page.getElementById("org.x:adults")?.textContent).toBe(
			"adultsPeople 18 or over.",
		);
		expect(page.querySelector("#ddi-broken + ul code")?.textContent).toBe(
			"urn:ddi:org.x:nothing:1",
		);
	});
});

describe("a codebook to place in a page", () => {
	it("has no landmark but its contents, and no title of its own", () => {
		const body = read(codebookHtml(CODEBOOK)).body;
		expect(body.querySelectorAll("main, header, h1, style")).toHaveLength(0);
		expect(body.querySelectorAll("nav")).toHaveLength(1);
		linksHold(body.ownerDocument);
	});
});

describe("the example bank's page", () => {
	it("is one page, nothing fetched, every anchor once and every link found", () => {
		const page = read(bankPage);
		selfContained(page);
		linksHold(page);
		expect(page.querySelectorAll("main article").length).toBeGreaterThan(13);
	});
});
