// @vitest-environment jsdom
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { domainSnippets } from "@qretools/core/editor";
import { describe, expect, it } from "vitest";
import { snippetSource } from "./complete.ts";
import { createEditor } from "./editor.ts";

const HEAD = "name: q\ntext: How often?\nintent: Prevalence of bus use\n";

/** An editor with `doc`, the snippet `label` picked at its end: the text after, and what's selected. */
const pick = (doc: string, label: string) => {
	const parent = document.createElement("div");
	document.body.append(parent);
	const editor = createEditor(
		parent,
		() => {},
		() => {},
		() => {},
		{ snippets: domainSnippets },
	);
	editor.sync({ id: 1, text: doc, diagnostics: [], marks: [] });
	const view = EditorView.findFromDOM(parent) as EditorView;
	const found = snippetSource(domainSnippets)(
		new CompletionContext(view.state, doc.length, false),
	);
	const option = found?.options.find((o) => o.label === label);
	if (found == null || typeof option?.apply !== "function")
		throw new Error(`no snippet ${label}`);
	option.apply(view, option, found.from, doc.length);
	const text = view.state.doc.toString();
	const { from, to } = view.state.selection.main;
	editor.destroy();
	return { text, caret: from, selected: text.slice(from, to) };
};

describe("a response domain written out, as picked in the editor", () => {
	it("lands at the top level with its fields indented, the caret at the first place", () => {
		const responses = pick(`${HEAD}res`, "responses");
		expect(responses.text).toBe(`${HEAD}responses:\n  "1": \n  "2": `);
		expect(responses.caret).toBe(`${HEAD}responses:\n  "1": `.length);
		expect(pick(`${HEAD}nu`, "number").text).toBe(
			`${HEAD}number:\n  min: \n  max: `,
		);
		expect(pick(`${HEAD}o`, "open").text).toBe(`${HEAD}open:\n  max_length: `);
	});

	it("opens unasked only once a word is typed; asked, on a blank line too", () => {
		const at = (doc: string, explicit: boolean) =>
			snippetSource(domainSnippets)(
				new CompletionContext(
					EditorState.create({ doc }),
					doc.length,
					explicit,
				),
			)?.options.map((o) => o.label);
		expect(at(HEAD, false)).toBeUndefined();
		expect(at(HEAD, true)).toEqual(["responses", "number", "open"]);
		expect(at(`${HEAD}n`, false)).toEqual(["number"]);
	});
});
