import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bankOf, instrumentOf, instrumentRefAt } from "@qretools/core";
import { readBank } from "@qretools/core/node";
import { describe, expect, it } from "vitest";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

describe("where an instrument names its banks' files", () => {
	it("is each ask's question and each named universe, by the place the name is written", async () => {
		const source = await readFile(
			here("../../fixtures/instruments/households.yaml"),
			"utf8",
		);
		const hh = bankOf(await readBank(here("../../fixtures/households")));
		const { refs: all } = instrumentOf(source, { banks: { hh } });
		const refs = all.flatMap((r) => (r.kind === "bank" ? [r] : []));
		expect(refs.length).toBeGreaterThan(0);
		for (const r of refs) {
			// The range is the name as written, alias and all, and names a file the bank has.
			expect(source.slice(r.range[0], r.range[1])).toMatch(/^"?hh\./);
			expect(r.alias).toBe("hh");
			expect(
				Object.keys(hh.questions).includes(r.path) ||
					Object.keys(hh.schemes).includes(r.path),
			).toBe(true);
		}
		const consent = source.indexOf("hh.consent");
		const followed = instrumentRefAt(all, consent + 3);
		expect(followed?.kind === "bank" && followed.path).toMatch(
			/consent\.yaml$/,
		);
		expect(instrumentRefAt(refs, 0)).toBeUndefined();
	});

	it("is nothing for a name its bank doesn't have", () => {
		const { refs } = instrumentOf(
			"name: x\nuses:\n  hh: ../hh\nflow:\n  - ask: hh.nope\n",
			{
				banks: {},
			},
		);
		expect(refs).toEqual([]);
	});

	it("follows the names conditions and placeholders read: a bank's answer, or the instrument's own", async () => {
		const source = await readFile(
			here("../../fixtures/instruments/households.yaml"),
			"utf8",
		);
		const hh = bankOf(await readBank(here("../../fixtures/households")));
		const { refs } = instrumentOf(source, { banks: { hh } });
		const written = (range: readonly [number, number]) =>
			source.slice(range[0], range[1]);
		// An input, in a placeholder: declared by its key under `inputs:`.
		const county = instrumentRefAt(refs, source.indexOf("{{county}}") + 3);
		expect(county).toMatchObject({
			kind: "here",
			name: "county",
			about: "From outside: From the sample file.",
		});
		if (county?.kind === "here") {
			expect(written(county.range)).toBe("county");
			expect(county.declared[0]).toBe(source.indexOf("  county:") + 2);
		}
		// A compute, in a condition: declared by its name.
		expect(instrumentRefAt(refs, source.indexOf("if: renter"))).toBeUndefined();
		const read = instrumentRefAt(refs, source.indexOf("if: renter") + 5);
		expect(read).toMatchObject({ kind: "here", name: "renter" });
		if (read?.kind === "here")
			expect(read.declared[0]).toBe(source.indexOf("compute: renter") + 9);
		// A roster's row number: declared by the roster's name.
		const row = instrumentRefAt(refs, source.indexOf("{{index}}") + 3);
		expect(row).toMatchObject({
			kind: "here",
			about: "The row number of `members`.",
		});
		if (row?.kind === "here")
			expect(row.declared[0]).toBe(source.indexOf("roster: members") + 8);
		// A bank's answer, in a condition: its question, as an ask's is.
		expect(
			instrumentRefAt(refs, source.indexOf("stop: hh.consent") + 8),
		).toMatchObject({
			kind: "bank",
			alias: "hh",
			path: "questions/household/consent.yaml",
		});
	});

	it("follows an input's shared scale into its bank", async () => {
		const hh = bankOf(await readBank(here("../../fixtures/households")));
		const source =
			"name: x\nuses:\n  hh: ../hh\ninputs:\n  feel:\n    responses: hh.yes_no\nflow:\n  - say: Hello.\n";
		const { refs } = instrumentOf(source, { banks: { hh } });
		expect(refs).toContainEqual({
			kind: "bank",
			range: [source.indexOf("hh.yes_no"), source.indexOf("hh.yes_no") + 9],
			alias: "hh",
			path: "scales/yes_no.yaml",
		});
	});
});

describe("the codes a condition compares a bank answer with", () => {
	const b = bankOf({
		"bank.yaml": "agency: org.example\n",
		"missing.yaml": 'labels:\n  "-9": Don\'t know\n',
		"scales/satisfied3.yaml":
			'labels:\n  "1": Satisfied\n  "2": Neither\n  "3": Dissatisfied\n',
		"questions/t/sat.yaml":
			"name: sat\ntext: Satisfied?\nintent: Sat.\nresponses: satisfied3\n",
		"questions/t/own.yaml":
			'name: own\ntext: Own?\nintent: Own.\nresponses:\n  "1": Own\n  "1.5": Part own\n  "2": Rent\n',
		"questions/t/news.yaml":
			'name: news\ntext: Which?\nintent: Which.\nselect: many\nresponses:\n  "1": Paper\n  "2": Radio\n',
	});
	/** The code refs (and an input's own code) in `cond`, as written, in document order. */
	const codes = (cond: string) => {
		const source = `name: x\nuses:\n  b: ./b\ninputs:\n  form:\n    responses:\n      "1": Form 1\nflow:\n  - stop: '${cond}'\n`;
		return instrumentOf(source, { banks: { b } })
			.refs.filter((r) => r.kind === "code" || r.range[0] !== r.range[1])
			.filter(
				(r) =>
					r.kind === "code" ||
					(r.kind === "here" && source[r.range[0]] === '"'),
			)
			.map((r) => ({
				written: source.slice(r.range[0], r.range[1]),
				...(r.kind === "code"
					? { path: r.path, at: r.at }
					: r.kind === "here"
						? { declared: source.slice(r.declared[0], r.declared[1]) }
						: {}),
				...(r.kind !== "bank" && { about: r.about }),
			}));
	};

	it("follows each code of a shared scale to its label there, either way round and in a set", () => {
		expect(codes('b.sat in {"1", "3"} or "2" = b.sat')).toEqual([
			{
				written: '"1"',
				path: "scales/satisfied3.yaml",
				at: "labels.1",
				about: "`Satisfied`, on the shared scale `satisfied3`.",
			},
			{
				written: '"3"',
				path: "scales/satisfied3.yaml",
				at: "labels.3",
				about: "`Dissatisfied`, on the shared scale `satisfied3`.",
			},
			{
				written: '"2"',
				path: "scales/satisfied3.yaml",
				at: "labels.2",
				about: "`Neither`, on the shared scale `satisfied3`.",
			},
		]);
	});

	it("follows a question's own code, dotted ones whole, and a missing value to its list", () => {
		expect(codes('b.own = "1.5" or b.own = "-9"')).toEqual([
			{
				written: '"1.5"',
				path: "questions/t/own.yaml",
				at: "responses.1.5",
				about: "`Part own`, in `own`'s own list.",
			},
			{
				written: '"-9"',
				path: "missing.yaml",
				at: "labels.-9",
				about: "`Don't know`, a missing value.",
			},
		]);
	});

	it("follows a select-all option's code to the binary scale", () => {
		expect(codes('b.news_1 = "1"')).toEqual([
			{
				written: '"1"',
				path: "scales/yesno01.yaml",
				at: "labels.1",
				about: "`Yes`, on the shared scale `yesno01`.",
			},
		]);
	});

	it("follows an input's own code to where the input declares it", () => {
		expect(codes('form = "1"')).toEqual([
			{
				written: '"1"',
				declared: '"1": Form 1',
				about: "`Form 1`, one of `form`'s codes.",
			},
		]);
	});

	it("is nothing for a code its list doesn't have, or a comparison that isn't equality", () => {
		expect(codes('b.sat = "7"')).toEqual([]);
		expect(codes('b.sat > "1"')).toEqual([]);
	});
});
