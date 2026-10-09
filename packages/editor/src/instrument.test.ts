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
	"questions/hh/own.yaml":
		'name: own\ntext: Do you own your home?\nintent: Tenure.\nresponses:\n  "1": Yes\n  "2": No\n',
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
				{ label: "hh.own", type: "class", detail: "Do you own your home?" },
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

describe("a coded answer's codes, as CodeMirror asks for them", () => {
	const STOP = "uses:\n  hh: ./hh\nflow:\n  - stop: hh.own = ";

	it("opens on its own where a code goes, and replaces the quotes once one is typed", () => {
		// Right after the operator (owner, 2026-10-09: it had waited for a quote).
		expect(ask(STOP, false)?.options.map((o) => o.label)).toEqual([
			'"1"',
			'"2"',
		]);
		// closeBrackets pairs the quote: the caret is between them.
		const doc = `${STOP}""`;
		const paired = instrumentSource(() => ({ hh }))(
			new CompletionContext(EditorState.create({ doc }), doc.length - 1, false),
		);
		expect(paired).toMatchObject({
			from: STOP.length,
			to: STOP.length + 2,
			options: [
				{ label: '"1"', type: "enum", detail: "Yes" },
				{ label: '"2"', type: "enum", detail: "No" },
			],
		});
		const narrows = paired?.validFor instanceof RegExp ? paired.validFor : /$^/;
		expect(['"', '"1', '"1"'].map((t) => narrows.test(t))).toEqual([
			true,
			true,
			true,
		]);
		expect(narrows.test("hh.x")).toBe(false);
		// Asked for, they're offered before the quote too.
		expect(ask(STOP, true)?.options).toHaveLength(2);
	});
});

describe("where no code goes", () => {
	it("opens nothing unasked: a name that isn't coded, after a set's brace, or before one", () => {
		const flow = "uses:\n  hh: ./hh\nflow:\n  - stop: ";
		expect(ask(`${flow}hh.size = `, false)).toBeNull();
		expect(ask(`${flow}'hh.own in {"1"} `, false)).toBeNull();
		expect(ask(`${flow}hh.own in `, false)).toBeNull();
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

	it("puts a space after a step's colon when typing straight after it", () => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const editor = createEditor(
			parent,
			() => {},
			() => {},
			() => {},
			{ completions: [] },
		);
		const text = "flow:\n  - ask:";
		editor.sync({ id: 1, text, diagnostics: [], marks: [] });
		const view = EditorView.findFromDOM(parent) as EditorView;
		view.dispatch({
			changes: { from: text.length, insert: "h" },
			userEvent: "input.type",
		});
		expect(view.state.doc.toString()).toBe("flow:\n  - ask: h");
		editor.destroy();
	});
});
