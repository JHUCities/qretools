import { CompletionContext } from "@codemirror/autocomplete";
import { yaml } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { stateExtensions } from "codemirror-json-schema";
import { yamlCompletion } from "codemirror-json-schema/yaml";
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
		number: {
			type: "object",
			properties: {
				min: { type: "number" },
				max: { type: "number" },
				unit: {
					anyOf: [
						{ type: "string", oneOf: [{ const: "days", description: "Days" }] },
						{ type: "string" },
					],
				},
			},
		},
		responses: {
			anyOf: [
				{ type: "string" },
				{
					type: "object",
					additionalProperties: {
						anyOf: [
							{ type: "string" },
							{
								type: "object",
								properties: {
									label: { type: "string" },
									note: { type: "string" },
								},
							},
						],
					},
				},
			],
		},
	},
};
const stateOf = (doc: string) =>
	EditorState.create({
		doc,
		extensions: [yaml(), stateExtensions(schema as never)],
	});
/** Our options at `▮`, or at the end of the text. */
const at = (marked: string) => {
	const doc = marked.replace("▮", "");
	const pos = marked.includes("▮") ? marked.indexOf("▮") : doc.length;
	return schemaCompletion(new CompletionContext(stateOf(doc), pos, true));
};
const labels = (marked: string) => at(marked)?.options.map((o) => o.label);

describe("completion's own options", () => {
	it("give a shared name its content on its row, and a key nothing", () => {
		expect(at("instruction: ")?.options).toEqual([
			{ label: "select_one", type: "enum", detail: "Select one" },
		]);
		const keys = at("name: q\n")?.options ?? [];
		expect(keys.map((o) => o.label)).toEqual([
			"title",
			"instruction",
			"number",
			"responses",
		]);
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

describe("completion at any depth, read from the parsed question", () => {
	it("completes a nested value, where the package offers nothing (so nothing twice)", () => {
		const doc = "number:\n  unit: ";
		expect(labels(doc)).toEqual(["days"]);
		const theirs = yamlCompletion()(
			new CompletionContext(stateOf(doc), doc.length, true),
		);
		expect(Array.isArray(theirs) ? theirs : (theirs?.options ?? [])).toEqual(
			[],
		);
	});

	it("offers the keys under a parent that are not written yet, blank lines aside", () => {
		expect(labels("number:\n  ")).toEqual(["min", "max", "unit"]);
		expect(labels("number:\n  min: 1\n\n  ")).toEqual(["max", "unit"]);
		expect(labels("number:\n  min: 1\n  ▮\n  max: 3\n")).toEqual(["unit"]);
	});

	it("follows a record's values, through a union's object branch", () => {
		expect(labels("responses:\n  1:\n    ")).toEqual(["label", "note"]);
	});

	it("inserts nothing with the caret inside a word", () => {
		expect(at("na▮me: q")).toBeNull();
	});
});

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
