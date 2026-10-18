import { describe, expect, it } from "vitest";
import { bankOf } from "../evaluate.ts";
import { instrumentOf } from "./instrument.ts";

const workspace = (extra: Record<string, string>) =>
	bankOf({
		"workspace.yaml": "agency: org.a\n",
		"scales/agree.yaml": 'labels:\n  "1": Agree\n',
		"questions/t/rate.yaml":
			"name: rate\ntext: Agree?\nintent: Agree.\nresponses: agree\n",
		"questions/t/news.yaml":
			'name: news\ntext: Which?\nintent: Which.\nselect: many\nresponses:\n  "1": Paper\n  "2": Radio\n',
		...extra,
	});

describe("two workspaces under one agency", () => {
	it("say once, on the later `uses` line, that they code select all that apply differently", () => {
		const banks = {
			a: workspace({}),
			b: workspace({
				"select_all.yaml":
					'chosen: { "1": Selected }\nnot_chosen: { "2": Not selected }\n',
				// A shared scale of the same name but other labels: a clash of its own.
				"scales/agree.yaml": 'labels:\n  "1": Agree strongly\n',
			}),
		};
		const r = instrumentOf(
			"name: x\nuses:\n  b: o/b@v1\n  a: o/a@v1\nflow:\n  - ask: a.news\n  - ask: b.news\n    as: news2\n  - ask: a.rate\n  - ask: b.rate\n    as: rate2\n",
			{ banks, agency: "org.i" },
		);
		const clashes = r.findings.filter((f) => f.code === "name-clash");
		expect(clashes.map((f) => [f.path, f.message])).toEqual([
			[
				"",
				expect.stringMatching(
					/^`urn:ddi:org\.a:scale-agree\.cat-0:1` would name/,
				),
			],
			[
				"uses.a",
				"`a` and `b` both publish as `org.a` but don't agree on how a select-all-that-apply option is stored.",
			],
			// `as` on a select-all question is refused, so both asks record its options.
			[
				"flow.1.ask",
				"The variable `news_1` would be recorded by `a.news` and by `b.news`.",
			],
			[
				"flow.1.ask",
				"The variable `news_2` would be recorded by `a.news` and by `b.news`.",
			],
		]);
		// The refusal itself is unchanged: every identity is still a collision.
		expect(
			r.collisions.filter((c) => c.urn.includes(":select-all.")),
		).toHaveLength(3);
	});
});
