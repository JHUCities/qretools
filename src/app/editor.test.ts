// @vitest-environment jsdom
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { changeBetween, createEditor, refRangeAt } from "./editor.js";

describe("the change an outside edit makes", () => {
	it("turns one text into the other, touching nothing outside the common start and end", () => {
		const a = "name: q\nresponses:\n  1: Yes\n  2: No\nselect: one\n";
		const b = "name: q\nresponses: yesno\nselect: one\n";
		const { from, to, insert } = changeBetween(a, b);
		expect(a.slice(0, from) + insert + a.slice(to)).toBe(b);
		expect(from).toBeGreaterThanOrEqual("name: q\nresponses:".length);
		expect(a.length - to).toBeGreaterThanOrEqual("\nselect: one\n".length);
	});

	it("handles a pure insertion, a deletion, and repeated characters at the seam", () => {
		expect(changeBetween("ab", "axb")).toEqual({ from: 1, to: 1, insert: "x" });
		expect(changeBetween("axb", "ab")).toEqual({ from: 1, to: 2, insert: "" });
		expect(changeBetween("aaa", "aaaa")).toEqual({
			from: 3,
			to: 3,
			insert: "a",
		});
		expect(changeBetween("same", "same")).toEqual({
			from: 4,
			to: 4,
			insert: "",
		});
	});
});

describe("a change from outside the editor (a quick fix)", () => {
	it("leaves the caret where it was and is undone on its own, the Model told", () => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const onEdit = vi.fn();
		const editor = createEditor(parent, onEdit, () => {});
		const sync = (text: string) =>
			editor.sync({ id: 1, text, diagnostics: [], marks: [], schema: {} });
		const before = "name: q\nnumber:\n  unit: Days\ntext: hello\n";
		const after = "name: q\nnumber:\n  unit: days\ntext: hello\n";
		sync(before);
		const view = EditorView.findFromDOM(
			parent.querySelector(".cm-editor") as HTMLElement,
		);
		if (!view) throw new Error("no view");
		const caret = before.indexOf("hello") + 2;
		view.dispatch({ selection: { anchor: caret } });
		sync(after);
		expect(view.state.doc.toString()).toBe(after);
		expect(view.state.selection.main.head).toBe(caret);
		expect(onEdit).not.toHaveBeenCalled();
		undo(view);
		expect(view.state.doc.toString()).toBe(before);
		expect(onEdit).toHaveBeenLastCalledWith(before);
		editor.destroy();
	});
});

describe("go to definition in the editor", () => {
	const setup = () => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const followed: number[] = [];
		const editor = createEditor(
			parent,
			() => {},
			() => {},
			(id, o) => {
				expect(id).toBe(1);
				followed.push(o);
			},
		);
		const text = "name: q\nresponses: agree4\n";
		const from = text.indexOf("agree4");
		editor.sync({
			id: 1,
			text,
			diagnostics: [],
			marks: [{ kind: "ref", range: [from, from + 6] }],
			schema: {},
		});
		const view = EditorView.findFromDOM(
			parent.querySelector(".cm-editor") as HTMLElement,
		);
		if (!view) throw new Error("no view");
		return { editor, view, followed, from, parent };
	};
	const mod = /Mac|iPhone|iPad/.test(navigator.platform)
		? { metaKey: true }
		: { ctrlKey: true };

	it("follows a Mod-click on a shared name, and leaves a Mod-click elsewhere to CodeMirror", () => {
		const { editor, followed, from, parent } = setup();
		const name = parent.querySelector(".cm-ref") as HTMLElement;
		const on = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			button: 0,
			...mod,
		});
		name.dispatchEvent(on);
		expect(followed).toEqual([from]);
		expect(on.defaultPrevented).toBe(true);
		const line = parent.querySelector(".cm-line") as HTMLElement;
		const off = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			button: 0,
			...mod,
		});
		line.dispatchEvent(off);
		expect(followed).toHaveLength(1);
		editor.destroy();
	});

	it("follows F12 only with the caret on a name", () => {
		const { editor, view, followed, from } = setup();
		view.dispatch({ selection: { anchor: 2 } });
		const away = new KeyboardEvent("keydown", {
			key: "F12",
			bubbles: true,
			cancelable: true,
		});
		view.contentDOM.dispatchEvent(away);
		expect(followed).toEqual([]);
		expect(away.defaultPrevented).toBe(false);
		view.dispatch({ selection: { anchor: from + 3 } });
		view.contentDOM.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "F12",
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(followed).toEqual([from + 3]);
		editor.destroy();
	});

	it("finds the name under the pointer, and not one that only touches it on the other side", () => {
		const { editor, view, from } = setup();
		const to = from + 6;
		const name = { from, to };
		expect(refRangeAt(view.state, from + 3)).toEqual(name);
		expect(refRangeAt(view.state, from, 1)).toEqual(name);
		expect(refRangeAt(view.state, from, -1)).toBeUndefined();
		expect(refRangeAt(view.state, to, -1)).toEqual(name);
		expect(refRangeAt(view.state, to, 1)).toBeUndefined();
		expect(refRangeAt(view.state, 2)).toBeUndefined();
		editor.destroy();
	});
});
