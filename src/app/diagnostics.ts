/** Findings as CodeMirror diagnostics. Pure; decides nothing about surveys. */
import type { Diagnostic } from "@codemirror/lint";
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
			message: f.hint ? `${f.message}\n${f.hint}` : f.message,
		};
	});
