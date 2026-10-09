// @vitest-environment jsdom

/**
 * The branch line's "Update": shown once the author's branch exists and is behind the
 * default branch, named by that branch; a conflict comes back as a notice with the way
 * to open a pull request.
 */
import { ThemeProvider } from "@primer/react/next";
import { ok } from "@qretools/core";
import type { Store, Updated } from "@qretools/shell";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createApp } from "../store.js";
import { App } from "./App.js";
import { AppContext } from "./AppContext.js";

const FILES = [
	{ path: "bank.yaml", sha: "s0", text: "agency: org.example\n" },
	{
		path: "questions/t/alpha.yaml",
		sha: "s1",
		text: 'name: alpha\ntext: Alpha?\nintent: Alpha.\nresponses:\n  "1": Yes\n  "2": No\n',
	},
];

function renderBank(from: "branch" | "default", answer: Updated = "conflict") {
	const asked: string[] = [];
	const store = {
		whoAmI: () =>
			Promise.resolve(
				ok({
					login: "me",
					avatarUrl: "https://a/me",
					access: { kind: "write" },
					defaultBranch: "trunk",
				}),
			),
		loadWorkspace: () =>
			Promise.resolve(
				ok({
					files: FILES,
					found: true,
					from,
					aheadBy: 1,
					behindBy: 2,
					unread: [],
				}),
			),
		updateFromDefault: () => {
			asked.push("update");
			return Promise.resolve(ok(answer));
		},
	} as unknown as Store;
	const app = createApp(
		{
			work: ok(undefined),
			settings: { owner: "o", repo: "r", path: "", remember: false },
			hasToken: true,
		},
		{
			makeStore: () => store,
			credentialStore: {
				load: () => ({ credentials: { access: "t" }, remember: false }),
				save: () => {},
				clear: () => {},
			},
		},
	);
	render(
		<AppContext.Provider value={app}>
			<ThemeProvider colorMode="light">
				<App />
			</ThemeProvider>
		</AppContext.Provider>,
	);
	return asked;
}

describe("the branch line's Update", () => {
	it("isn't offered before the branch exists", async () => {
		renderBank("default");
		await act(async () => {});
		expect(screen.getByRole("link", { name: /2 behind trunk/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /^Update/ })).toBeNull();
	});

	it("brings the default branch in, and shows a conflict with the way to a pull request", async () => {
		const asked = renderBank("branch");
		await act(async () => {});
		fireEvent.click(
			screen.getByRole("button", { name: /^Update\s*from trunk$/ }),
		);
		await act(async () => {});
		expect(asked).toEqual(["update"]);
		const notice = screen
			.getByText("Your branch conflicts with updates to trunk.")
			.closest("section, div") as HTMLElement;
		expect(
			within(notice.parentElement as HTMLElement)
				.getByRole("link", { name: /Open a pull request/ })
				.getAttribute("href"),
		).toBe("https://github.com/o/r/compare/trunk...qretools-me?expand=1");
	});
});
