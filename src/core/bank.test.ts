import { describe, expect, it } from "vitest";
import { bankLocation, describeChange, folderOf } from "./bank.js";
import { EMPTY_ENV } from "./surface/env.js";
import { parseSurface } from "./surface/parse.js";

const draft = (text: string) => parseSurface(text, EMPTY_ENV).draft;

describe("bank paths", () => {
	it("files a new question by its name prefix", () => {
		expect(folderOf("nhd_sat")).toBe("nhd");
		expect(folderOf("q")).toBe("q");
		expect(bankLocation(draft("name: nhd_sat\n"))).toEqual({
			ok: true,
			value: {
				folder: "nhd",
				name: "nhd_sat",
				path: "questions/nhd/nhd_sat.yaml",
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
		const r = bankLocation(draft("text: Q?\n"));
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
