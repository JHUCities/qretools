import { describe, expect, it } from "vitest";
import { evaluate } from "../core/evaluate.js";
import { locate } from "../core/findings.js";
import { toDiagnostics } from "./diagnostics.js";
import { init } from "./model.js";
import { update } from "./update.js";

describe("update", () => {
	const [model] = init;

	it("starts by asking for the DDI schema", () => {
		expect(init[1]).toEqual([{ kind: "loadDdiSchema" }]);
		expect(model.ddiSchema.kind).toBe("loading");
	});

	it("an edit replaces the source and asks for nothing", () => {
		expect(update(model, { kind: "edited", text: "name: q\n" })).toEqual([
			{ ...model, source: "name: q\n" },
			[],
		]);
	});

	it("a click names a place; update resolves it against the text as it is now", () => {
		const click = {
			kind: "locationClicked",
			target: { path: "text", severity: "hole" },
		} as const;
		const source = "name: q\ntext:\nintent: i\nopen:\n";
		const [same, cmds] = update({ ...model, source }, click);
		expect(same.source).toBe(source);
		const [cmd] = cmds;
		expect(
			cmd?.kind === "revealRange" && source.slice(cmd.range[0], cmd.range[1]),
		).toBe("text:");

		// The same click after the author has typed two lines above it still finds `text:`.
		const moved = `source: Original\nconcept: c\n${source}`;
		const [cmd2] = update({ ...model, source: moved }, click)[1];
		expect(
			cmd2?.kind === "revealRange" && moved.slice(cmd2.range[0], cmd2.range[1]),
		).toBe("text:");
	});

	it("messages and the model are plain data", () => {
		const [next] = update(model, {
			kind: "ddiSchemaLoaded",
			result: { kind: "ready" },
		});
		expect(JSON.parse(JSON.stringify(next))).toEqual(next);
	});
});

describe("diagnostics", () => {
	it("maps holes to CodeMirror's hint severity and keeps every range inside the text", () => {
		for (const source of [
			"",
			"name: q\n",
			"a: [",
			"name: q\ntext: x: y\nresponses:\n  1:\n",
		]) {
			const ev = evaluate(source, "org.example", {});
			for (const d of toDiagnostics(ev.findings, ev.ranges)) {
				expect(d.from).toBeLessThanOrEqual(d.to);
				expect(d.to).toBeLessThanOrEqual(source.length);
			}
		}
		const ev = evaluate("name: q\n", "org.example", {});
		expect(
			toDiagnostics(ev.findings, ev.ranges).some((d) => d.severity === "hint"),
		).toBe(true);
	});

	it("a hole for a key not yet typed points at the end of the text, not the whole document", () => {
		const source = "name: q\n";
		const ev = evaluate(source, "org.example", {});
		const textHole = ev.findings.find((f) => f.path === "text");
		expect(textHole && locate(textHole, ev.ranges)).toEqual([
			source.length,
			source.length,
		]);
	});
});
