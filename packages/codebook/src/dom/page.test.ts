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
			format: { kind: "number", min: 0, max: 120, unit: "</dd><b>years" },
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
	instruments: [
		{
			urn: urn("survey"),
			name: "survey",
			label: t("Pets & people"),
			steps: [
				{ kind: "say", construct: urn("hello"), text: t("Hello.") },
				{
					kind: "section",
					construct: urn("about"),
					label: t("About you"),
					order: "Random",
					steps: [
						{
							kind: "branch",
							construct: urn("if-adult"),
							type: "warning",
							arms: [
								{
									command: { command: "adult", language: "VTL" },
									steps: [
										{
											kind: "loop",
											construct: urn("people"),
											ref: {
												kind: "ref",
												type: "Loop",
												urn: urn("people"),
												name: "people",
											},
											loop: "Loop",
											command: { command: "i <= n" },
											steps: [
												{
													kind: "ask",
													construct: urn("ask-age"),
													question: urn("age-q"),
													entry: {
														urn: urn("age"),
														name: "age",
														label: t("Age"),
													},
												},
											],
										},
									],
								},
							],
							otherwise: [
								{
									kind: "compute",
									construct: urn("set-x"),
									command: { command: "x := 1" },
									assigns: [
										{
											kind: "ref",
											type: "Parameter",
											urn: urn("x"),
											name: "x",
										},
									],
								},
							],
						},
					],
				},
				{
					kind: "ask",
					construct: urn("ask-pets"),
					question: urn("pets"),
					entry: { urn: urn("pets"), name: "pets" },
				},
				// The same construct again: drawn twice, its id once.
				{
					kind: "ask",
					construct: urn("ask-age"),
					question: urn("age-q"),
					entry: { urn: urn("age"), name: "age", label: t("Age") },
				},
			],
		},
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

	it("gives each item a link to itself to share, the contents' own, named in words", () => {
		const items = [
			...page.querySelectorAll("main [id]:is(article, section.ddi-group)"),
		];
		expect(items.length).toBeGreaterThan(0);
		for (const item of items) {
			const self = item.querySelectorAll(
				":scope > .ddi-heading > a.ddi-anchor",
			);
			expect(self, item.id).toHaveLength(1);
			const href = self[0]?.getAttribute("href") ?? "";
			expect(indicated(page, href)).toBe(item);
			// Shared items and instruments aren't in the contents one by one; every entry is.
			if (
				item.closest(
					"[aria-labelledby=ddi-shared], [aria-labelledby=ddi-instrument]",
				) === null
			)
				expect(
					page.querySelector(`nav a[href="${href}"]`),
					href,
				).not.toBeNull();
		}
		const age = page.querySelector("#org\\.x\\:age .ddi-anchor");
		expect(age?.querySelector('[aria-hidden="true"]')?.textContent).toBe("#");
		expect(age?.querySelector(".ddi-visually-hidden")?.textContent).toBe(
			"Link to age Age",
		);
		expect(age?.querySelector("[lang]")?.getAttribute("lang")).toBe("en");
		// The heading's own name is its words alone.
		expect(age?.closest(".ddi-heading")?.querySelector("h3")?.textContent).toBe(
			"age Age",
		);
		expect(page.querySelectorAll("a a")).toHaveLength(0);
	});

	it("maps the instrument after the contents, each ask linked to its entry", () => {
		const map = page.querySelector('[aria-labelledby="ddi-instrument"]');
		expect(map?.previousElementSibling?.tagName).toBe("NAV");
		expect(map?.nextElementSibling?.getAttribute("aria-labelledby")).toBe(
			"ddi-variables",
		);
		// In the contents in the page's order: before the variables.
		expect(page.querySelector("nav h2 + ul a")?.getAttribute("href")).toBe(
			"#ddi-instrument",
		);
		expect(map?.querySelector("h3")?.textContent).toBe("survey Pets & people");
		for (const list of map?.querySelectorAll("ol") ?? [])
			expect(list.getAttribute("role")).toBe("list");
		// Numbered at each place, by name: the question's words follow.
		const asks = [...(map?.querySelectorAll(".ddi-ask-name") ?? [])];
		expect(asks.map((a) => a.textContent)).toEqual([
			"1. age",
			"2. pets",
			"3. age",
		]);
		const href = (p: Element | undefined) =>
			p?.querySelector("a")?.getAttribute("href") ?? "";
		expect(indicated(page, href(asks[0]))?.id).toBe("org.x:age");
		// A select-all question links to its group.
		expect(
			indicated(page, href(asks[1]))?.classList.contains("ddi-group"),
		).toBe(true);
		const words = (map?.textContent ?? "").replace(/\s+/g, " ");
		for (const said of [
			"Hello.",
			"About you (Random)",
			"If adult (VTL) (warning)",
			"Repeated people while i <= n",
			"Else",
			"Computed x is set to x := 1",
		])
			expect(words).toContain(said);
		// The page's own words, in a French codebook, are marked English.
		const ifWord = [...(map?.querySelectorAll("p") ?? [])].find((p) =>
			p.textContent?.startsWith("If"),
		);
		expect(ifWord?.querySelector("[lang]")?.getAttribute("lang")).toBe("en");
	});

	it("links where a question is asked to its place in the map, an id once however often it's drawn", () => {
		const back = [
			...page.querySelectorAll<HTMLAnchorElement>("#org\\.x\\:age dd a"),
		].find((a) => a.textContent === "in the instrument");
		expect(back?.textContent).toBe("in the instrument");
		const place = indicated(page, back?.getAttribute("href") ?? "");
		expect(place?.tagName).toBe("LI");
		expect(place?.querySelector("a")?.textContent).toBe("age");
		expect(page.querySelectorAll('[id="org.x:ask-age"]')).toHaveLength(1);
	});

	it("names, never links, a key holding half a character", () => {
		const half = "a\uD800";
		expect(anchorOf(urn(half))).toBeUndefined();
		expect(hrefOf(half)).toBe("#a%EF%BF%BD");
		const at = read(pageOf({ ...CODEBOOK, entries: [entry(half)] }));
		expect(
			at
				.querySelector("[aria-labelledby=ddi-variables] article")
				?.hasAttribute("id"),
		).toBe(false);
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
		expect(at.querySelectorAll("section.ddi-group")).toHaveLength(1);
		expect(at.querySelectorAll("section.ddi-group article")).toHaveLength(2);
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
		// A loop has its place in the instrument's map, so a reference to it links there.
		const loop = page.querySelector('#org\\.x\\:age [data-kind="Loop"]');
		expect(loop?.tagName).toBe("A");
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
				"Unless consent = 2 (VTL) and if adult; repeated in people; section order: Random; in the instrument",
			Format: "Number from 0 to 120, in </dd><b>years",
		});
		// The one plain string written into a particular: still escaped.
		expect(
			[...(age?.querySelectorAll("dd") ?? [])].find((dd) =>
				dd.textContent?.startsWith("Number"),
			)?.children,
		).toHaveLength(0);
		expect(age?.querySelector("blockquote")?.children).toHaveLength(2);
		expect(age?.querySelector(".ddi-instruction")?.textContent).toBe(
			"Read aloud.",
		);
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
		const adults = page.getElementById("org.x:adults");
		expect(adults?.querySelector("h4")?.textContent).toBe("adults");
		expect(adults?.querySelector("p")?.textContent).toBe("People 18 or over.");
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
