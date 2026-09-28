// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Folder } from "../tree.js";
import { BankFilter, Browser } from "./Browser.js";

const folders: readonly Folder[] = [
	{
		name: "nhd",
		expanded: true,
		leaves: [
			{
				id: 1,
				name: "nhd_sat",
				title: "Satisfaction",
				status: { kind: "complete" },
				unsaved: false,
				draft: false,
				failed: false,
				busy: false,
			},
		],
	},
	{
		name: "svy",
		expanded: false,
		leaves: [
			{
				id: 2,
				name: "svy_x",
				title: undefined,
				status: { kind: "incomplete", holes: 1, errors: 0 },
				unsaved: false,
				draft: true,
				failed: false,
				busy: false,
			},
		],
	},
];

describe("Browser", () => {
	it("shows folders and leaves, and a click on a leaf opens the question", () => {
		const dispatch = vi.fn();
		render(
			<Browser
				folders={folders}
				sections={[]}
				filter=""
				open={undefined}
				dispatch={dispatch}
			/>,
		);
		expect(
			screen.getAllByRole("treeitem", { name: "nhd" })[0] as HTMLElement,
		).toBeTruthy();
		fireEvent.click(
			screen.getAllByRole("treeitem", { name: "nhd_sat" })[0] as HTMLElement,
		);
		expect(dispatch).toHaveBeenCalledWith({ kind: "fileOpened", id: 1 });
	});

	it("typing in the filter dispatches filterChanged with the text", () => {
		const dispatch = vi.fn();
		render(<BankFilter filter="" loading={false} dispatch={dispatch} />);
		fireEvent.change(screen.getByRole("searchbox"), {
			target: { value: "sat" },
		});
		expect(dispatch).toHaveBeenCalledWith({
			kind: "filterChanged",
			text: "sat",
		});
	});

	it("toggling a folder dispatches folderToggled", () => {
		const dispatch = vi.fn();
		render(
			<Browser
				folders={folders}
				sections={[]}
				filter=""
				open={undefined}
				dispatch={dispatch}
			/>,
		);
		fireEvent.click(
			screen.getAllByRole("treeitem", { name: "svy" })[0] as HTMLElement,
		);
		expect(dispatch).toHaveBeenCalledWith({
			kind: "folderToggled",
			folder: "svy",
		});
	});

	it("shows shared elements by kind, with how many questions use each", () => {
		const dispatch = vi.fn();
		render(
			<Browser
				folders={[]}
				sections={[
					{
						kind: "scale",
						label: "Scales",
						key: "scheme:scale",
						expanded: true,
						leaves: [
							{
								id: 7,
								name: "agree4",
								usedBy: 12,
								status: { kind: "complete" },
								unsaved: false,
								draft: false,
								failed: false,
								busy: false,
							},
						],
					},
					{
						kind: "universe",
						label: "Universes",
						key: "scheme:universe",
						expanded: true,
						leaves: [],
					},
				]}
				filter=""
				open={undefined}
				dispatch={dispatch}
			/>,
		);
		expect(screen.getByText("used by 12")).toBeTruthy();
		fireEvent.click(
			screen.getAllByRole("treeitem", { name: /agree4/ })[0] as HTMLElement,
		);
		expect(dispatch).toHaveBeenCalledWith({ kind: "fileOpened", id: 7 });
	});
});
