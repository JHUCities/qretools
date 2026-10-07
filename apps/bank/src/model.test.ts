import { describe, expect, it } from "vitest";
import { EXAMPLE_SCALES } from "./model.js";

describe("EXAMPLE_SCALES", () => {
	it("names each bundled scale by its file, as a bank names a scale", () => {
		expect(Object.keys(EXAMPLE_SCALES).sort()).toEqual([
			"agree4",
			"satisfied5",
		]);
	});
});
