import { describe, expect, it } from "vitest";
import {
	bankLocation,
	describeChange,
	describeMove,
	saveableName,
} from "./bank.js";
import { EMPTY_ENV } from "./surface/env.js";
import { parseSurface } from "./surface/parse.js";

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

describe("describeChange", () => {
	const before = draft(
		"name: nhd_sat\ntext: Old?\nintent: Prevalence of a thing\nresponses:\n  1: a\n  2: b\n",
	);
	it("names the operation and the fields that changed", () => {
		expect(describeChange(undefined, before)).toBe("Add nhd_sat");
		expect(describeChange(before, undefined)).toBe("Delete nhd_sat");
		expect(describeChange(before, before)).toBe("Update nhd_sat");
		expect(
			describeChange(
				before,
				draft(
					"name: nhd_sat\ntext: New?\nintent: Prevalence of a thing\nresponses:\n  1: a\n  2: c\n",
				),
			),
		).toBe("Update nhd_sat: text, responses");
		expect(
			describeChange(
				before,
				draft(
					"name: nhd_sat\ntext: Old?\nintent: Prevalence of a thing\nnumber:\n  min: 0\n",
				),
			),
		).toBe("Update nhd_sat: number");
	});

	it("copes with nameless drafts", () => {
		expect(describeChange(undefined, draft(""))).toBe("Add question");
	});
});

describe("describeMove", () => {
	const before = draft("name: nhd_sat\ntext: Q?\n");
	it("names the folder, and any fields saved with the move", () => {
		expect(describeMove(before, before, "nhd_sat", "svy", false)).toBe(
			"Move nhd_sat to svy",
		);
		// A change to no field (a comment, spacing, a legacy value) is still said.
		expect(describeMove(before, before, "nhd_sat", "svy", true)).toBe(
			"Move nhd_sat to svy and update text",
		);
		expect(
			describeMove(
				before,
				draft("name: nhd_sat\ntext: Q?\nnote: n\ninstruction: Select one\n"),
				"nhd_sat",
				"svy",
				true,
			),
		).toBe("Move nhd_sat to svy and update instruction, note");
	});
});
