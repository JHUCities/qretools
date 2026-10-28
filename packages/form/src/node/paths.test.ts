import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	bankOf,
	ddiIndexOf,
	instrumentOf,
	readInstruments,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { describe, expect, it } from "vitest";
import { pathsPageOf } from "../paths.ts";

const root = join(import.meta.dirname, "../../../core/fixtures/households");
const made = instrumentOf(
	await readFile(`${root}/instruments/households.yaml`, "utf8"),
	{ banks: { hh: bankOf(await readWorkspace(root)) }, agency: "org.example" },
);
const page = pathsPageOf(readInstruments(ddiIndexOf(made.ddi)).value);
const text = page.replace(/<[^>]+>/g, "");

describe("the paths report", () => {
	it("draws core's counts for households (checked by hand in core's test)", () => {
		expect(text).toContain("Paths7 (1 screened out)");
		expect(text).toContain(
			"Questions per path not screened out6 to 10 (median 8)",
		);
		expect(text).toContain("Never askedNone");
	});

	it("says, per question, where it's asked from and what decides it", () => {
		expect(text).toContain("consentEvery path0Nothing");
		expect(text).toContain("rent3 of 73 to 5consent, renter (from tenure)");
		expect(text).toContain("commentsEvery path5 to 9consent");
	});

	it("says how rosters and screen-outs are counted", () => {
		expect(text).toContain("1 path ends at a screen-out");
		expect(text).toContain("counted once, as if it had one row");
	});
});
