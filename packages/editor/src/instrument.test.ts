// @vitest-environment jsdom
import {
	CompletionContext,
	type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type Bank, bankOf } from "@qretools/core";
import { newLineAfter } from "@qretools/core/editor";
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
				{
					label: "hh.own",
					type: "class",
					detail: "select one, 2 options · Do you own your home?",
				},
				{
					label: "hh.size",
					type: "class",
					detail: "number · How many people live here?",
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

describe("a step's fields and new steps, as CodeMirror asks for them", () => {
	const STEP = "uses:\n  hh: ./hh\nflow:\n  - ask: hh.size\n    ";
	it("open once a letter is typed at its column, never on the bare indent", () => {
		expect(ask(STEP, false)).toBeNull();
		const c = ask(`${STEP}c`, false);
		expect(c?.options.map((o) => [o.label, o.type])).toEqual([
			["checks", "property"],
			["- compute", "keyword"],
			// The same step written out with its fields (a snippet).
			["- compute", "text"],
		]);
		expect(c?.filter).toBe(false);
		const a = ask(`${STEP}a`, false);
		expect(a?.options.map((o) => [o.label, o.apply])).toEqual([
			["as", "    as: "],
			["- ask", "  - ask: "],
		]);
		// Asked for, they're there before a letter.
		expect(ask(STEP, true)?.options.length).toBeGreaterThan(2);
	});
});

describe("a construct written out, as picked in the editor", () => {
	/** An editor with `doc`, the snippet option `label` picked at its end: the text after. */
	const pick = (doc: string, label: string) => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const editor = createEditor(
			parent,
			() => {},
			() => {},
			() => {},
			{ completions: [] },
		);
		editor.sync({ id: 1, text: doc, diagnostics: [], marks: [] });
		const view = EditorView.findFromDOM(parent) as EditorView;
		const found = instrumentSource(() => ({ hh }))(
			new CompletionContext(view.state, doc.length, true),
		);
		const option = found?.options.find(
			(o) => o.label === label && o.type === "text",
		);
		if (found == null || typeof option?.apply !== "function")
			throw new Error(`no snippet ${label}`);
		option.apply(view, option, found.from, found.to ?? doc.length);
		const text = view.state.doc.toString();
		const { from, to } = view.state.selection.main;
		editor.destroy();
		return { text, selected: text.slice(from, to) };
	};

	it("lands with every line at its column, the first place selected", () => {
		const head = "uses:\n  hh: ./hh\nflow:\n";
		expect(pick(`${head}  - ro`, "roster")).toEqual({
			text: `${head}  - roster: name\n    count: \n    flow:\n      - `,
			selected: "name",
		});
		// A new step from a step's field column: the dash goes back to the step's.
		expect(pick(`${head}  - ask: hh.size\n    r`, "- roster")).toEqual({
			text: `${head}  - ask: hh.size\n  - roster: name\n    count: \n    flow:\n      - `,
			selected: "name",
		});
		// A check under checks, deeper.
		expect(
			pick(`${head}  - ask: hh.size\n    checks:\n      - en`, "ensure"),
		).toEqual({
			text: `${head}  - ask: hh.size\n    checks:\n      - ensure: \n        severity: warning\n        message: `,
			selected: "",
		});
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

describe("Return in an instrument", () => {
	/** An editor with `text`, the caret at its `|`, and Return pressed: the text after. */
	const press = (
		text: string,
		options: { newLine?: boolean; readOnly?: boolean } = { newLine: true },
	) => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const editor = createEditor(
			parent,
			() => {},
			() => {},
			() => {},
			{
				completions: [],
				...(options.newLine && { newLine: newLineAfter }),
			},
		);
		const at = text.indexOf("|");
		editor.sync({
			id: 1,
			text: text.replace("|", ""),
			diagnostics: [],
			marks: [],
			...(options.readOnly && { readOnly: true }),
		});
		const view = EditorView.findFromDOM(parent) as EditorView;
		view.dispatch({ selection: { anchor: at } });
		const enter = new KeyboardEvent("keydown", {
			key: "Enter",
			keyCode: 13,
			bubbles: true,
			cancelable: true,
		});
		view.contentDOM.dispatchEvent(enter);
		const after = view.state.doc.toString();
		const caret = view.state.selection.main.head;
		editor.destroy();
		return `${after.slice(0, caret)}|${after.slice(caret)}`;
	};

	it("opens a list field's first item, two past its key", () => {
		expect(press("name: x\nflow:|\n")).toBe("name: x\nflow:\n  - |\n");
		expect(press("flow:\n  - if: x\n    then:  |\n")).toBe(
			"flow:\n  - if: x\n    then:\n      - |\n",
		);
	});

	it("goes to a step's field column after it, and opens nothing: a second Return is a blank line", () => {
		expect(press("flow:\n  - ask: hh.size|\n")).toBe(
			"flow:\n  - ask: hh.size\n    |\n",
		);
		const second = press("flow:\n  - ask: hh.size\n    |\n");
		expect(second).not.toContain("as:");
		expect(second).not.toContain("checks:");
	});

	it("leaves Return alone elsewhere, in another author's version, and in a question", () => {
		// CodeMirror's own newline (with its indentation) in each case: no dash.
		for (const [text, options] of [
			["name:|\n", undefined],
			["flow:| []\n", undefined],
			["flow:|\n", { readOnly: true }],
			["flow:|\n", { newLine: false }],
		] as const)
			expect(press(text, options ?? { newLine: true })).not.toContain("- ");
	});
});
