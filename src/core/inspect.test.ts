import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";
import { pathAt } from "./findings.js";
import { inspect } from "./inspect.js";
import { EMPTY_ENV } from "./surface/env.js";
import { parseSurface } from "./surface/parse.js";

const env = {
	...EMPTY_ENV,
	scales: { agree4: { codes: [{ code: "1", label: "Agree" }] } },
	universes: { renters: { text: "Renters" }, adults: { text: "Adults" } },
};
const source =
	"name: q\ntext: Q?\nintent: Prevalence of x\nuniverse: renters\nresponses:\n  1.5: Half\n  2: Two\ninstruction: select_x\n";
const ev = evaluate(source, "org.example", env);
const at = (needle: string) => source.indexOf(needle) + 1;

describe("pathAt", () => {
	it("takes the smallest range holding the offset, and a dotted code whole", () => {
		const { ranges } = parseSurface(source, env);
		expect(pathAt(ranges, at("Half"))).toBe("responses.1.5");
		expect(pathAt(ranges, at("responses:"))).toBe("responses");
		expect(pathAt(ranges, 0)).toBe("name");
	});
});

describe("inspect", () => {
	it("a resolved name: the field, what it names, and the names in scope", () => {
		expect(inspect(ev, env, at("renters"))).toMatchObject({
			path: "universe",
			key: "universe",
			names: ["adults", "renters"],
			mention: {
				scheme: "universe",
				name: "renters",
				value: { text: "Renters" },
			},
		});
		expect(inspect(ev, env, at("renters"))?.description).toMatch(/\w/);
	});

	it("an unresolved name has no value, and shows the hole the editor underlines there", () => {
		const i = inspect(ev, env, at("select_x"));
		expect(i?.mention).toEqual({ scheme: "instruction", name: "select_x" });
		expect(i?.findings.map((f) => f.severity)).toEqual(["hole"]);
	});

	it("a plain field has no names; outside any field there is nothing; offsets are clamped", () => {
		const text = inspect(ev, env, at("Q?"));
		expect(text).toMatchObject({ key: "text" });
		expect(text?.names).toBeUndefined();
		expect(() => inspect(ev, env, 10_000)).not.toThrow();
		expect(inspect(evaluate("", "org.example", env), env, 0)).toBeUndefined();
	});
});
