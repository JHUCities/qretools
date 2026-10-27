/**
 * The instrument's specification beyond the one fixture: another language, several
 * inputs, two instruments in one document, and a stop inside a branch.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bankOf, instrumentOf, type Json } from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { describe, expect, it } from "vitest";
import { pageOf } from "../html.ts";
import { codebookOf, parse } from "../model.ts";

const root = fileURLToPath(
	new URL("../../../core/fixtures/households", import.meta.url),
);
const households = () =>
	readFile(`${root}/instruments/households.yaml`, "utf8");
const ddiOf = async (source: string, alias = "hh") =>
	instrumentOf(source, {
		banks: { [alias]: bankOf(await readWorkspace(root)) },
		agency: "org.example",
	}).ddi as Json;
const page = (ddi: Json, lang?: string) => {
	const parsed = parse(ddi);
	if (!parsed.ok) throw new Error("unparsed");
	return pageOf(codebookOf(parsed.value, lang === undefined ? {} : { lang }));
};
/** The instrument's part of a page. */
const spec = (html: string) =>
	html.slice(
		html.indexOf('<section aria-labelledby="ddi-instrument">'),
		html.indexOf('<section aria-labelledby="ddi-variables">'),
	);
/** Its text, tags gone. */
const words = (html: string) =>
	html
		.replace(/<[^>]*>/g, " ")
		.replaceAll("&#39;", "'")
		.replace(/\s+/g, " ");

/** The document with every string also in Spanish ("es …"), each displayed text in its own AudienceLanguage. */
function bilingual(j: unknown): unknown {
	const spanish = (x: unknown): unknown =>
		Array.isArray(x)
			? x.map(spanish)
			: x !== null && typeof x === "object"
				? Object.fromEntries(
						Object.entries(x).map(([k, v]) =>
							k === "LanguageTag"
								? [k, "es"]
								: k === "Value" && typeof v === "string"
									? [k, `es ${v}`]
									: k === "AudienceLanguage"
										? [k, "es"]
										: [k, spanish(v)],
						),
					)
				: x;
	if (Array.isArray(j))
		return j.flatMap((x) => {
			const o = x as Record<string, unknown>;
			const tagged = JSON.stringify(o).includes('"LanguageTag":"en"');
			return o !== null &&
				typeof o === "object" &&
				tagged &&
				("MultilingualStringValue" in o || "TextContent" in o)
				? "TextContent" in o
					? [
							{ ...(bilingual(x) as object), AudienceLanguage: "en" },
							{ ...(spanish(x) as object), AudienceLanguage: "es" },
						]
					: [bilingual(x), spanish(x)]
				: [bilingual(x)];
		});
	return j !== null && typeof j === "object"
		? Object.fromEntries(Object.entries(j).map(([k, v]) => [k, bilingual(v)]))
		: j;
}

describe("the specification", () => {
	it("is in the language asked for, its own phrases marked English", async () => {
		const ddi = bilingual(await ddiOf(await households())) as Json;
		const es = spec(page(ddi, "es"));
		// The document's words in Spanish: a question, a statement, an option, a check's message.
		for (const said of [
			"es How old is this person?",
			"es Thank you for your time.",
			"es Rent",
			"es That's a lot for a month's rent.",
		])
			expect(words(es)).toContain(said);
		expect(words(spec(page(ddi, "en")))).not.toContain("es How old");
		// The page's own words are all inside an element marked English.
		const unmarked = words(
			es.replace(/<(\w+)\b[^>]*\blang="en"[^>]*>.*?<\/\1>/gs, " "),
		);
		for (const own of [
			"Check:",
			"warn",
			"End the interview",
			"Repeated",
			"until",
			"at most",
			"up to",
			"Universe:",
			"Also:",
			"Ask if",
			"Show if",
			"Comes with each case",
			"or not answered",
			"is “",
			"Number",
			"Text,",
		])
			expect(unmarked).not.toContain(own);
	});

	it("lists each input that comes with each case, with its values or none", async () => {
		const html = page(
			await ddiOf(`name: two
uses:
  hh: ../
inputs:
  county:
    responses:
      "1": North County
      "2": South County
    description: From the sample file.
  wave:
    number:
      min: 1
flow:
  - say: Thank you, {{county}}, wave {{wave}}.
  - ask: hh.consent
`),
		);
		expect(words(spec(html))).toContain(
			"Comes with each case: county (North County, South County). From the sample file. Comes with each case: wave .",
		);
		for (const name of ["county", "wave"]) {
			const entry = html.slice(
				html.indexOf(`id="org.example:instrument-two.var-${name}"`),
			);
			expect(entry).toContain(
				"<dt>Asked</dt><dd>Not asked: comes with each case</dd>",
			);
		}
	});

	it("draws two instruments in one document apart: numbers, ids, inputs and places", async () => {
		const one = await ddiOf(await households());
		const two = await ddiOf(
			await readFile(`${root}/instruments/remote.yaml`, "utf8"),
			"bas",
		);
		const both = Object.fromEntries(
			[...new Set([...Object.keys(one), ...Object.keys(two)])].map((k) => [
				k,
				{
					...((one as Record<string, object>)[k] ?? {}),
					...((two as Record<string, object>)[k] ?? {}),
				},
			]),
		) as Json;
		const html = page(both);
		const s = spec(html);
		expect(words(s)).toContain("Instruments");
		// Each instrument numbers its own questions from 1.
		expect([...s.matchAll(/ddi-number">(\d+)\./g)].map((m) => m[1])).toEqual([
			..."1 2 3 4 5 6 7 8 9 10".split(" "),
			"1",
		]);
		// Inputs under the instrument that reads them only.
		expect(s.match(/Comes with each case/g)).toHaveLength(1);
		const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
		expect(new Set(ids).size).toBe(ids.length);
		for (const [, to] of html.matchAll(/href="#([^"]+)"/g))
			expect(ids).toContain(decodeURIComponent(to ?? ""));
		// consent is asked in both: each place names its instrument.
		const consent = html.slice(
			html.indexOf('<section aria-labelledby="ddi-variables">'),
		);
		expect(words(consent)).toContain("Asked Always in households");
		expect(words(consent)).toContain("Asked Always in remote");
	});

	it("prints a roster's line on the page of what it repeats", async () => {
		const html = page(await ddiOf(await households()));
		expect(html).toContain('<p class="ddi-loop">');
		expect(html).toContain(".ddi-if, .ddi-loop { break-after: avoid; }");
	});

	it("keeps what follows a stop inside the branch that holds it", async () => {
		const s = spec(
			page(
				await ddiOf(`name: nested
uses:
  hh: ../
flow:
  - ask: hh.tenure
  - if: hh.tenure = "2"
    then:
      - ask: hh.consent
      - stop: hh.consent = "2"
        say: Thank you for your time.
      - ask: hh.rent
  - ask: hh.comments
`),
			),
		);
		// How deep in lists each ask is drawn: the asks after the stop stay at its depth.
		const depth = (name: string) => {
			const before = s.slice(0, s.indexOf(`<code>${name}</code>`));
			return (
				(before.match(/<ol\b/g) ?? []).length -
				(before.match(/<\/ol>/g) ?? []).length
			);
		};
		expect(depth("rent")).toBe(depth("consent"));
		expect(depth("rent")).toBeGreaterThan(depth("tenure"));
		expect(depth("comments")).toBe(depth("tenure"));
		expect(words(s)).toContain("End the interview if consent is “No”");
	});
});
