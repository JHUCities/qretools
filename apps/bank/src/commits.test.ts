import { type Draft, EMPTY_ENV, parseSurface } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { describeChange, describeMove } from "./commits.js";

const draft = (text: string): Draft => parseSurface(text, EMPTY_ENV).draft;

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
