import { describe, expect, it } from "vitest";
import { bankLocation, saveableName } from "./bank.ts";
import { EMPTY_ENV } from "./surface/env.ts";
import { parseSurface } from "./surface/parse.ts";

const draft = (text: string) => parseSurface(text, EMPTY_ENV).draft;

describe("bank paths", () => {
	it("reads nothing about where a question goes from its name", () => {
		// No bank's convention, such as a topic prefix: the folder is always chosen.
		expect(saveableName(draft("name: nhd_sat\n"))).toEqual({
			ok: true,
			value: "nhd_sat",
		});
		expect(bankLocation(draft("name: nhd_sat\n"), "")).toMatchObject({
			ok: false,
			error: { message: "Choose a folder." },
		});
		expect(bankLocation(draft("name: nhd_sat\n"), "health")).toEqual({
			ok: true,
			value: {
				folder: "health",
				name: "nhd_sat",
				path: "questions/health/nhd_sat.yaml",
			},
		});
	});

	it("takes the folder the author chose, and refuses a malformed one", () => {
		expect(bankLocation(draft("name: dem_latx\n"), "svy")).toMatchObject({
			ok: true,
			value: { path: "questions/svy/dem_latx.yaml" },
		});
		expect(bankLocation(draft("name: dem_latx\n"), "Not A Folder").ok).toBe(
			false,
		);
	});

	it("needs a valid name, and says so as a hole", () => {
		const r = bankLocation(draft("text: Q?\n"), "health");
		expect(r.ok).toBe(false);
		expect(!r.ok && r.error.path).toBe("name");
	});
});
