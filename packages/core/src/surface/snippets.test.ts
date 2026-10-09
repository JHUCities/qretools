import { describe, expect, it } from "vitest";
import { evaluate } from "../evaluate.ts";
import { EMPTY_ENV } from "./env.ts";
import { parseSurface } from "./parse.ts";
import { DOMAIN_SNIPPETS, domainSnippets } from "./snippets.ts";

const HEAD =
	"name: q\ntext: How often?\nintent: Prevalence of bus use among adults\n";
/** A template with each place as Tab leaves it: empty. */
const left = (snippet: string) => snippet.replace(/\$\{\}/g, "");

describe("a response domain written out", () => {
	it("left as written, has holes to fill in and nothing wrong, lints included", () => {
		for (const [key, { snippet }] of Object.entries(DOMAIN_SNIPPETS)) {
			// Through `evaluate`, so a lint (too few responses) would show too.
			const { findings } = evaluate(`${HEAD}${left(snippet)}\n`, EMPTY_ENV);
			const wrong = findings
				.filter((f) => f.severity !== "hole" && f.path.startsWith(key))
				.map((f) => `${f.code}@${f.path}`);
			expect([key, wrong]).toEqual([key, []]);
			expect(findings.some((f) => f.severity === "hole")).toBe(true);
		}
	});

	it("filled in, is complete", () => {
		const filled = (snippet: string) => {
			let n = 0;
			return snippet.replace(/\$\{\}/g, () => ["Often", "Rarely"][n++] ?? "");
		};
		// min and max, or a max_length.
		const numbers = (snippet: string, values: readonly number[]) => {
			let n = 0;
			return snippet.replace(/\$\{\}/g, () => String(values[n++]));
		};
		for (const [key, { snippet }] of Object.entries(DOMAIN_SNIPPETS)) {
			const text =
				key === "responses"
					? filled(snippet)
					: numbers(snippet, key === "number" ? [0, 10] : [200]);
			const { findings } = parseSurface(`${HEAD}${text}\n`, EMPTY_ENV);
			expect([key, findings.map((f) => `${f.code}@${f.path}`)]).toEqual([
				key,
				[],
			]);
		}
	});

	it("is offered where a top-level field goes, narrowed by the word typed, from its start", () => {
		const doc = `${HEAD}re`;
		expect(
			domainSnippets(doc, doc.length).map((s) => [s.label, s.from]),
		).toEqual([["responses", HEAD.length]]);
		const blank = `${HEAD}`;
		expect(domainSnippets(blank, blank.length).map((s) => s.label)).toEqual([
			"responses",
			"number",
			"open",
		]);
	});

	it("is offered nowhere else: once a domain is written, or under a field", () => {
		const answered = `${HEAD}open: {}\n`;
		expect(domainSnippets(answered, answered.length)).toEqual([]);
		const under = `${HEAD}number:\n  `;
		expect(domainSnippets(under, under.length)).toEqual([]);
	});
});
