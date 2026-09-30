import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";
import { pathAt } from "./findings.js";
import { inspect, mentionAt } from "./inspect.js";
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
		expect(inspect(ev, env, source, at("renters"))).toMatchObject({
			path: "universe",
			key: "universe",
			names: ["adults", "renters"],
			mention: {
				scheme: "universe",
				name: "renters",
				value: { text: "Renters" },
			},
		});
		expect(inspect(ev, env, source, at("renters"))?.description).toMatch(/\w/);
	});

	it("an unresolved name has no value (the finding is the Findings panel's to say)", () => {
		const i = inspect(ev, env, source, at("select_x"));
		expect(i?.mention).toEqual({ scheme: "instruction", name: "select_x" });
		expect(i).not.toHaveProperty("findings");
	});

	it("a plain field has no names; outside any field there is nothing; offsets are clamped", () => {
		const text = inspect(ev, env, source, at("Q?"));
		expect(text).toMatchObject({ key: "text" });
		expect(text?.names).toBeUndefined();
		expect(() => inspect(ev, env, source, 10_000)).not.toThrow();
	});

	it("a space just typed at the end of a value stays in its field", () => {
		for (const text of [
			"name: a\ntext: How are \n",
			"name: a\ntext: How are ",
		]) {
			const ev = evaluate(text, "org.example", env);
			const after = text.indexOf("are ") + "are ".length;
			expect(inspect(ev, env, text, after)?.key).toBe("text");
		}
		// A blank line is still the document, indented or not.
		const blank = "name: a\n  \ntext: hi\n";
		const ev = evaluate(blank, "org.example", env);
		expect(inspect(ev, env, blank, 10)?.key).toBeUndefined();
		// An indented new line under a block map is that map: the author is about to
		// type another code.
		const codes = "name: a\nresponses:\n  1: A\n  ";
		const onCodes = evaluate(codes, "org.example", env);
		expect(inspect(onCodes, env, codes, codes.length)?.key).toBe("responses");
	});

	it("between fields and at the end is the document, with the holes of absent fields", () => {
		const text = "name: a\ntext: hi\n";
		const doc = inspect(
			evaluate(text, "org.example", env),
			env,
			text,
			text.length,
		);
		// The document level: no key, and the question's own description.
		expect(doc?.key).toBeUndefined();
		expect(doc?.description).toMatch(/survey question/i);
	});
});

describe("the inspector on a unit", () => {
	it("describes the unit field itself, lists the units, and names the one written", () => {
		const env = { ...EMPTY_ENV, units: { days: { label: "days" } } };
		const source = "name: q\nnumber:\n  unit: days\n";
		const at = inspect(
			evaluate(source, "org.example", env),
			env,
			source,
			source.indexOf("days") + 2,
		);
		expect(at?.path).toBe("number.unit");
		expect(at?.description).toMatch(/unit/i);
		expect(at?.names).toEqual(["days"]);
		expect(at?.mention).toMatchObject({ scheme: "unit", name: "days" });
	});
});

describe("the shared name at an offset", () => {
	it("is found on the name and at its end, resolved or not, and nowhere else", () => {
		const source = "name: q\nresponses: agree4\nuniverse: nobody\n";
		const p = parseSurface(source, EMPTY_ENV);
		const at = (o: number) => mentionAt(p.ranges, p.mentions, source, o)?.name;
		expect(at(source.indexOf("agree4") + 2)).toBe("agree4");
		expect(at(source.indexOf("agree4") + "agree4".length)).toBe("agree4");
		expect(at(source.indexOf("nobody") + 1)).toBe("nobody");
		expect(at(2)).toBeUndefined();
	});
});
