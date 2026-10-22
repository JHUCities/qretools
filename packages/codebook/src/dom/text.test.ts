// @vitest-environment jsdom
/** Codebook text written as HTML and read back by a real parser: nothing breaks out. */
import { describe, expect, it } from "vitest";
import { anchorOf, blockHtml, hrefOf, inlineHtml } from "../html.ts";
import type { Span } from "../text.ts";

/** Strings made of what could end an element or an attribute, from a fixed seed. */
function* awkward(count: number): Generator<string> {
	const parts = [
		"<",
		">",
		"&",
		'"',
		"'",
		"</p>",
		"</title>",
		"&amp;",
		"a",
		" ",
	];
	let seed = 7;
	for (let n = 0; n < count; n++) {
		let s = "";
		for (let i = 0; i < 1 + (n % 12); i++) {
			seed = (seed * 48271) % 2147483647;
			s += parts[seed % parts.length];
		}
		yield s;
	}
}

const parsed = (html: string): HTMLElement =>
	new DOMParser().parseFromString(html, "text/html").body;

const ANCHORS = new Set(["org.x:pets"]);

describe("codebook text as HTML", () => {
	it("keeps every string inside its element and its attribute", () => {
		for (const s of awkward(200)) {
			const spans: Span[] = [
				{ kind: "text", text: s },
				{ kind: "code", text: s },
				{ kind: "link", text: s, url: `https://example.org/${s}` },
				{ kind: "ref", type: s, urn: "urn:ddi:org.x:pets:1", name: s },
				{ kind: "ref", type: "Universe", urn: `urn:ddi:org.x:${s}:1` },
			];
			const body = parsed(blockHtml([spans], { anchors: ANCHORS }));
			expect(body.children).toHaveLength(1);
			const p = body.children[0] as HTMLElement;
			expect([...p.children].map((c) => c.tagName)).toEqual([
				"CODE",
				"A",
				"A",
				"SPAN",
			]);
			const [code, link, ref, unlinked] = [...p.children] as HTMLElement[];
			expect(code?.textContent).toBe(s);
			expect(link?.getAttribute("href")).toBe(`https://example.org/${s}`);
			expect(link?.textContent).toBe(s);
			expect(ref?.dataset).toMatchObject({ kind: s, name: s });
			expect(ref?.getAttribute("href")).toBe("#org.x:pets");
			expect(ref?.textContent).toBe(s);
			expect(unlinked?.dataset).toMatchObject({
				urn: `urn:ddi:org.x:${s}:1`,
				kind: "Universe",
			});
			expect(unlinked?.dataset.name).toBeUndefined();
			expect(p.textContent).toBe(`${s}${s}${s}${s}urn:ddi:org.x:${s}:1`);
		}
	});

	it("links a reference at any version to its item's anchor, and names one with none", () => {
		const html = inlineHtml(
			[
				[
					{ kind: "ref", type: "QuestionItem", urn: "urn:ddi:org.x:pets:1" },
					{ kind: "ref", type: "Loop", urn: "urn:ddi:org.x:cars:2" },
				],
			],
			{ anchors: ANCHORS },
		);
		const [pets, cars] = [...parsed(html).children];
		expect(pets?.getAttribute("href")).toBe("#org.x:pets");
		expect(pets?.textContent).toBe("urn:ddi:org.x:pets:1");
		expect(cars?.tagName).toBe("SPAN");
		expect(anchorOf("urn:ddi:org.x:pets:2")).toBe("org.x:pets");
		expect(anchorOf("urn:ddi:org.x:a pet:2")).toBeUndefined();
		const id = "org.x:@#$1";
		const page = parsed(`<p id="${id}"></p>`).ownerDocument;
		expect(
			page.getElementById(decodeURIComponent(hrefOf(id).slice(1)))?.id,
		).toBe(id);
	});

	it("writes no link inside a link, and runs paragraphs on where none can go", () => {
		const html = inlineHtml(
			[
				[{ kind: "link", text: "a.org", url: "https://a.org" }],
				[{ kind: "ref", type: "Universe", urn: "urn:ddi:org.x:pets:1" }],
			],
			{ anchors: ANCHORS, inLink: true },
		);
		const body = parsed(`<a href="#x">${html}</a>`);
		expect(body.querySelectorAll("a")).toHaveLength(1);
		expect(body.textContent).toBe("a.org urn:ddi:org.x:pets:1");
	});
});
