/** Findings as CodeMirror diagnostics. Decides nothing about surveys. */

import type { Diagnostic } from "@codemirror/lint";
import {
	codeSpans,
	type Finding,
	type Fix,
	plainText,
	type Range,
	type Severity,
} from "@qretools/core";
import { locate } from "@qretools/core/editor";

/** CodeMirror has four severities and nothing else uses `hint`, so holes get it, and their own look. */
const SEVERITY: Readonly<Record<Severity, Diagnostic["severity"]>> = {
	hole: "hint",
	error: "error",
	warning: "warning",
	info: "info",
};

/**
 * A finding's fix becomes the tooltip's own action button (CodeMirror's), which only
 * hands the fix back: `onFix` dispatches it, and absent (a read-only view) there is none.
 */
export const toDiagnostics = (
	findings: readonly Finding[],
	ranges: Readonly<Record<string, Range>>,
	onFix?: (fix: Fix) => void,
): readonly Diagnostic[] =>
	findings.map((f) => {
		const [from, to] = locate(f, ranges);
		const { fix } = f;
		return {
			from,
			to,
			severity: SEVERITY[f.severity],
			message: plainText(f.hint ? `${f.message}\n${f.hint}` : f.message),
			renderMessage: () => messageNode(f),
			...(fix !== undefined &&
				onFix !== undefined && {
					actions: [
						{
							name: plainText(fix.label),
							apply: () => onFix(fix),
							// The editor's quick-fix key applies it (editor.ts), and its hint says so.
							markClass: "cm-quickFix",
						},
					],
				}),
		};
	});

/** The tooltip's content: message and hint, backticked names as code, as in the Findings list. */
function messageNode(f: Finding): Node {
	const line = (text: string, className: string): HTMLElement => {
		const div = document.createElement("div");
		div.className = className;
		for (const s of codeSpans(text)) {
			if (s.code) {
				const code = document.createElement("code");
				code.className = "code";
				code.textContent = s.text;
				div.append(code);
			} else div.append(s.text);
		}
		return div;
	};
	const node = document.createElement("div");
	node.append(line(f.message, "cm-finding-message"));
	if (f.hint !== undefined) node.append(line(f.hint, "cm-finding-hint"));
	if (f.detail !== undefined) {
		const detail = document.createElement("div");
		detail.className = "cm-finding-detail";
		detail.textContent = f.detail;
		node.append(detail);
	}
	return node;
}
