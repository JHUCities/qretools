// @vitest-environment jsdom
import type { EditorView } from "@codemirror/view";
import type { Finding } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { toDiagnostics } from "./diagnostics.ts";

describe("a finding's hover", () => {
	it("says its severity in words first, as the Findings list names it", () => {
		const finding = (severity: Finding["severity"]): Finding => ({
			code: "hole",
			severity,
			path: "name",
			message: "Something about `name`.",
		});
		const said = toDiagnostics([finding("error"), finding("hole")], {
			name: [0, 4],
		}).map(
			(d) =>
				(d.renderMessage?.({} as EditorView) as HTMLElement | undefined)
					?.textContent,
		);
		expect(said[0]).toMatch(/^errorSomething about name\./);
		expect(said[1]).toMatch(/^to fill inSomething/);
	});
});
