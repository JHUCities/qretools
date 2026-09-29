import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { stateExtensions } from "codemirror-json-schema";
import { describe, expect, it } from "vitest";
import { schemaCompletion, withoutInfo } from "./complete.js";

const schema = {
	type: "object",
	properties: {
		name: { type: "string", description: "The name." },
		title: { type: "string", description: "A title." },
		instruction: {
			type: "string",
			oneOf: [{ const: "select_one", description: "Select one" }],
		},
	},
};
const at = (doc: string) => {
	const state = EditorState.create({
		doc,
		extensions: [stateExtensions(schema as never)],
	});
	return schemaCompletion(new CompletionContext(state, doc.length, true));
};

describe("completion's own options", () => {
	it("give a shared name its content on its row, and a key nothing", () => {
		expect(at("instruction: ")?.options).toEqual([
			{ label: "select_one", type: "enum", detail: "Select one" },
		]);
		const keys = at("name: q\n")?.options ?? [];
		expect(keys.map((o) => o.label)).toEqual(["title", "instruction"]);
		expect(
			keys.every((o) => o.detail === undefined && o.info === undefined),
		).toBe(true);
	});

	it("step aside once a prefix is typed at the top level, and never stay valid for it (keys appeared twice)", () => {
		const result = at("name: q\n");
		expect(result?.validFor).toBeUndefined();
		expect(at("name: q\nt")).toBeNull();
	});
});

const context = new CompletionContext(EditorState.create({ doc: "" }), 0, true);

describe("the package's options, under one rule", () => {
	it("move a value's description to its row, and drop a key's panel and the type name", () => {
		const source = withoutInfo(() => ({
			from: 0,
			options: [
				{ label: "select_one", type: "string", info: "Select one" },
				{
					label: "title",
					type: "property",
					detail: "string",
					info: () => document.createElement("div"),
				},
			],
		}));
		const result = source(context);
		expect(result?.options).toEqual([
			{ label: "select_one", type: "string", detail: "Select one" },
			{ label: "title", type: "property" },
		]);
	});

	it("reads the package's empty answer as none", () => {
		expect(withoutInfo(() => [])(context)).toBeNull();
		expect(withoutInfo(() => null)(context)).toBeNull();
	});
});
