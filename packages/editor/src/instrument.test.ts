// @vitest-environment jsdom
import {
	CompletionContext,
	type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type Bank, bankOf } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { createEditor } from "./editor.ts";
import { instrumentSource } from "./instrument.ts";

const hh = bankOf({
	"bank.yaml": "agency: org.example\n",
	"questions/hh/size.yaml":
		"name: size\ntext: How many people live here?\nintent: Household size.\nnumber:\n  min: 1\n",
});

/** The source's answer at the end of `doc`, asked for explicitly or not. */
const ask = (
	doc: string,
	explicit: boolean,
	banks: Record<string, Bank> = { hh },
) =>
	instrumentSource(() => banks)(
		new CompletionContext(EditorState.create({ doc }), doc.length, explicit),
	);

const HEAD = "uses:\n  hh: ./hh\nflow:\n  - ask: ";

describe("completion in an instrument, as CodeMirror asks for it", () => {
	it("offers the questions when asked, with their text, and replaces from the word's start", () => {
		const asked = ask(HEAD, true);
		expect(asked).toMatchObject({
			from: HEAD.length,
			options: [
				{
					label: "hh.size",
					type: "class",
					detail: "How many people live here?",
				},
			],
		});
		const typed = ask(`${HEAD}hh.s`, false);
		expect(typed?.from).toBe(HEAD.length);
		// Typing on, dot included, narrows the same list rather than asking again.
		expect(
			typed?.validFor instanceof RegExp && typed.validFor.test("hh.si"),
		).toBe(true);
	});

	it("opens on its own only once a word is being typed, and never empty", () => {
		expect(ask(HEAD, false)).toBeNull();
		expect(ask(`${HEAD}hh.s`, true, {})).toBeNull();
		expect(ask("flow:\n  - say: x", true)).toBeNull();
	});
});

describe("an editor given its own completions", () => {
	it("offers those, and none of the schema's, and is never given a schema", () => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const mine: CompletionSource = () => null;
		const editor = createEditor(
			parent,
			() => {},
			() => {},
			() => {},
			{ completions: [mine] },
		);
		editor.sync({ id: 1, text: "flow: []\n", diagnostics: [], marks: [] });
		const view = EditorView.findFromDOM(parent) as EditorView;
		expect(view.state.languageDataAt("autocomplete", 0)).toEqual([mine]);
		editor.destroy();
	});
});
