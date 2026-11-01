// @vitest-environment jsdom
import {
	acceptCompletion,
	CompletionContext,
	currentCompletions,
	nextSnippetField,
	startCompletion,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { domainSnippets, questionJsonSchema } from "@qretools/core/editor";
import { stateExtensions } from "codemirror-json-schema";
import { describe, expect, it, vi } from "vitest";
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
					EditorState.create({ doc, extensions: stateExtensions() }),
					doc.length,
					explicit,
				),
			)?.options.map((o) => o.label);
		expect(at(HEAD, false)).toBeUndefined();
		expect(at(HEAD, true)).toEqual(["responses", "number", "open"]);
		expect(at(`${HEAD}n`, false)).toEqual(["number"]);
	});
});

describe("in the editor, as it sorts them", () => {
	/** `typed` at the end of `doc`: what's listed, then the text Enter would leave. */
	const complete = async (doc: string, typed: string, ask = false) => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const editor = createEditor(
			parent,
			() => {},
			() => {},
			() => {},
			{ snippets: domainSnippets },
		);
		const schema = questionJsonSchema();
		editor.sync({ id: 1, text: doc, diagnostics: [], marks: [], schema });
		const view = EditorView.findFromDOM(parent) as EditorView;
		view.focus();
		const at = doc.length + typed.length;
		view.dispatch({
			changes: { from: doc.length, insert: typed },
			selection: { anchor: at },
			userEvent: "input.type",
		});
		if (ask) startCompletion(view);
		await vi.waitFor(() =>
			expect(currentCompletions(view.state).length).toBeGreaterThan(0),
		);
		const listed = currentCompletions(view.state).map((o) =>
			`${o.label} ${o.detail ?? ""}`.trim(),
		);
		// CodeMirror ignores Enter for its first moments, lest it take a stray key.
		await new Promise((done) => setTimeout(done, 100));
		acceptCompletion(view);
		const text = view.state.doc.toString().slice(doc.length);
		const caret = () =>
			view.state.doc.sliceString(doc.length, view.state.selection.main.head);
		const first = caret();
		nextSnippetField(view);
		const places = [first, caret()];
		editor.destroy();
		return { listed, text, places };
	};
	const BARE = "text: How often?\nintent: Prevalence of bus use\n";

	it("puts a field written out above its bare key, so Enter takes it", async () => {
		const { listed, text } = await complete(HEAD, "num");
		expect(listed).toEqual(["number with min and max", "number"]);
		expect(text).toBe("number:\n  min: \n  max: ");
	});

	it("keeps name first when `n` could be either", async () => {
		const { listed } = await complete(BARE, "n");
		expect(listed.slice(0, 2)).toEqual(["name", "number with min and max"]);
	});

	it("offers the one-line form after `number: `, and after `open:` when asked", async () => {
		expect((await complete(HEAD, "number: ")).text).toBe(
			"number: { min: , max:  }",
		);
		expect((await complete(HEAD, "open:", true)).text).toBe(
			"open: { max_length:  }",
		);
	});

	it("moves from min to max with Tab", async () => {
		const { places } = await complete(HEAD, "number: ");
		expect(places).toEqual(["number: { min: ", "number: { min: , max: "]);
	});
});
