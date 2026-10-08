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
		const { refs } = instrumentOf(source, { banks: { hh } });
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
		expect(instrumentRefAt(refs, consent + 3)?.path).toMatch(/consent\.yaml$/);
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
});
