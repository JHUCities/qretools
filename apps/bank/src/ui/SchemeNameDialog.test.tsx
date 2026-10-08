// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Naming } from "../model.js";
import { SchemeNameDialog } from "./SchemeNameDialog.js";

const naming = (over: Partial<Naming>): Naming => ({
	kind: "instruction",
	name: "se",
	text: "",
	bank: "",
	purpose: { kind: "create", use: { id: 1, path: "instruction" } },
	...over,
});

describe("the name dialog", () => {
	it("asks a new instruction for its name and text, the name editable and prefilled", () => {
		const dispatch = vi.fn();
		render(
			<SchemeNameDialog
				naming={naming({})}
				problem={undefined}
				dispatch={dispatch}
			/>,
		);
		const name = screen.getByRole("textbox", {
			name: "Name",
		}) as HTMLInputElement;
		expect(name.value).toBe("se");
		fireEvent.change(name, { target: { value: "select_all" } });
		expect(dispatch).toHaveBeenCalledWith({
			kind: "schemeNameChanged",
			name: "select_all",
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Text" }), {
			target: { value: "Select all that apply" },
		});
		expect(dispatch).toHaveBeenCalledWith({
			kind: "schemeTextChanged",
			text: "Select all that apply",
		});
		expect(
			screen.getByText(/The question you came from will use it/),
		).toBeTruthy();
	});

	it("asks a scale, or a rename, for its name only", () => {
		render(
			<SchemeNameDialog
				naming={naming({ kind: "scale", purpose: { kind: "rename", id: 2 } })}
				problem={undefined}
				dispatch={vi.fn()}
			/>,
		);
		expect(screen.queryByRole("textbox", { name: "Text" })).toBeNull();
		expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy();
	});
});
