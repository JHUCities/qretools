// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { EMPTY_ENV, type Env, parseSurface } from "@qretools/core";
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
	const chosen: unknown[] = [];
	const editor = createEditor(
		parent,
		() => {},
		() => {},
		() => {},
		{
			livelit: {
				choices: (source) =>
					source.kind === "scheme" ? choicesOf(env, source.scheme) : [],
				choose: (livelit, value) => chosen.push({ id: livelit.id, value }),
				act: (fix) => chosen.push(fix),
			},
		},
	);
	editor.sync({
		id: 1,
		text,
		diagnostics: [],
		marks: [],
		livelits: livelitsOf(text, parseSurface(text, env)),
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
		expect(chosen).toEqual([{ id: "responses", value: "yes_no" }]);
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

describe("a checklist picker", () => {
	it("ticks what is chosen, and Apply hands back the set in the choices' order", () => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const chosen: unknown[] = [];
		const editor = createEditor(
			parent,
			() => {},
			() => {},
			() => {},
			{
				livelit: {
					choices: () => [],
					choose: (livelit, value) => chosen.push({ id: livelit.id, value }),
					act: () => {},
				},
			},
		);
		const text = "agency: org.example\nrequired: [note]\n";
		editor.sync({
			id: 1,
			text,
			diagnostics: [],
			marks: [],
			livelits: [
				{
					id: "required",
					label: "Choose the fields every question must have",
					at: text.length - 1,
					field: [20, text.length - 1],
					span: [30, text.length - 1],
					picker: {
						kind: "many",
						source: {
							kind: "enum",
							values: [
								{ name: "title", detail: "" },
								{ name: "note", detail: "" },
							],
						},
						chosen: ["note"],
					},
					actions: [],
				},
			],
		});
		(parent.querySelector("button.cm-livelit") as HTMLButtonElement).click();
		const boxes = [
			...parent.querySelectorAll<HTMLInputElement>(
				'[role="dialog"] input[type="checkbox"]',
			),
		];
		expect(boxes.map((b) => [b.value, b.checked])).toEqual([
			["title", false],
			["note", true],
		]);
		(boxes[0] as HTMLInputElement).click();
		(parent.querySelector(".cm-livelit-apply") as HTMLButtonElement).click();
		expect(chosen).toEqual([{ id: "required", value: ["title", "note"] }]);
		expect(parent.querySelector('[role="dialog"]')).toBeNull();
		editor.destroy();
	});
});
