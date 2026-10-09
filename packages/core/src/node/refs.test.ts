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
