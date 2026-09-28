/** Findings as CodeMirror diagnostics. Decides nothing about surveys. */
import type { Diagnostic } from "@codemirror/lint";
import { codeSpans, plainText } from "../core/codeSpans.js";
import {
	type Finding,
	locate,
	type Range,
	type Severity,
} from "../core/findings.js";

/** CodeMirror has four severities and nothing else uses `hint`, so holes get it, and their own look. */
const SEVERITY: Readonly<Record<Severity, Diagnostic["severity"]>> = {
	hole: "hint",
	error: "error",
	warning: "warning",
	info: "info",
};

export const toDiagnostics = (
	findings: readonly Finding[],
	ranges: Readonly<Record<string, Range>>,
): readonly Diagnostic[] =>
	findings.map((f) => {
		const [from, to] = locate(f, ranges);
		return {
			from,
			to,
			severity: SEVERITY[f.severity],
			message: plainText(f.hint ? `${f.message}\n${f.hint}` : f.message),
			renderMessage: () => messageNode(f),
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
	return node;
}
