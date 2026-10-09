// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { EMPTY_ENV, type Env, type Fix, parseSurface } from "@qretools/core";
import { choicesOf, livelitsOf } from "@qretools/core/editor";
import { describe, expect, it } from "vitest";
import { createEditor } from "./editor.ts";

const env: Env = {
	...EMPTY_ENV,
	scales: {
		agree4: {
			codes: [
				{ code: "1", label: "Agree" },
				{ code: "2", label: "Disagree" },
			],
		},
		yes_no: {
			codes: [
				{ code: "1", label: "Yes" },
				{ code: "2", label: "No" },
			],
		},
	},
};
const TEXT = "name: q\ntext: Is it so?\nintent: To see why.\nresponses:\n";

/** An editor showing `text` with its livelits; what the app was asked to apply. */
function open(text = TEXT, readOnly = false) {
	const parent = document.createElement("div");
	document.body.append(parent);
	const chosen: Fix[] = [];
	const editor = createEditor(
		parent,
		() => {},
		() => {},
		() => {},
		{
			livelit: {
				choices: (kind) => choicesOf(env, kind),
				choose: (fix) => chosen.push(fix),
			},
		},
	);
	editor.sync({
		id: 1,
		text,
		diagnostics: [],
		marks: [],
		livelits: livelitsOf(parseSurface(text, env)),
		...(readOnly && { readOnly: true }),
	});
	const view = EditorView.findFromDOM(parent) as EditorView;
	return { parent, view, chosen, editor };
}

const press = (view: EditorView, key: string, mod = false) =>
	view.contentDOM.dispatchEvent(
		new KeyboardEvent("keydown", {
			key,
			keyCode: key === "." ? 190 : 0,
			metaKey: mod && /Mac/.test(navigator.platform),
			ctrlKey: mod && !/Mac/.test(navigator.platform),
			bubbles: true,
			cancelable: true,
		}),
	);

describe("a scale picker in the editor", () => {
	it("draws a named button after the field, and none in another author's version", () => {
		const { parent, editor } = open();
		const button = parent.querySelector("button.cm-livelit");
		expect(button?.getAttribute("aria-label")).toBe("Choose a shared scale");
		editor.destroy();
		const { parent: theirs } = open(TEXT, true);
		expect(theirs.querySelector("button.cm-livelit")).toBeNull();
	});

	it("opens on a click, lists the scales with their labels, and hands back the one chosen", () => {
		const { parent, chosen } = open();
		(parent.querySelector("button.cm-livelit") as HTMLButtonElement).click();
		const dialog = parent.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.getAttribute("aria-label")).toBe("Choose a shared scale");
		const choices = [...dialog.querySelectorAll(".cm-livelit-choice")];
		expect(choices.map((c) => c.textContent)).toEqual([
			"agree41 Agree · 2 Disagree",
			"yes_no1 Yes · 2 No",
		]);
		(choices[1] as HTMLButtonElement).click();
		expect(chosen).toEqual([
			{
				kind: "edit",
				label: "Use `yes_no`",
				edits: [{ path: "responses", value: "yes_no" }],
			},
		]);
		expect(parent.querySelector('[role="dialog"]')).toBeNull();
	});

	it("opens from the keyboard on the field, offers a new one, and Escape gives the caret back", () => {
		const { parent, view, chosen } = open();
		view.dispatch({ selection: { anchor: TEXT.indexOf("responses") + 2 } });
		press(view, ".", true);
		const dialog = parent.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog).not.toBeNull();
		const create = dialog.querySelector(
			".cm-livelit-create",
		) as HTMLButtonElement;
		expect(create.textContent).toBe("New shared scale…");
		dialog.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(parent.querySelector('[role="dialog"]')).toBeNull();
		expect(chosen).toEqual([]);
		// Elsewhere, the key is a quick fix's: nothing opens.
		view.dispatch({ selection: { anchor: 2 } });
		press(view, ".", true);
		expect(parent.querySelector('[role="dialog"]')).toBeNull();
	});

	it("marks the scale already named, and closes when the text changes", () => {
		const text = TEXT.replace("responses:\n", "responses: agree4\n");
		const { parent, view } = open(text);
		(parent.querySelector("button.cm-livelit") as HTMLButtonElement).click();
		const current = parent.querySelector(
			'.cm-livelit-choice[aria-current="true"]',
		);
		expect(current?.textContent?.startsWith("agree4")).toBe(true);
		view.dispatch({ changes: { from: 0, insert: "#" } });
		expect(parent.querySelector('[role="dialog"]')).toBeNull();
	});
});
