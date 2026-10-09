/**
 * Completion in an instrument, as CodeMirror asks for it: the core's
 * `instrumentCompletion` (bank questions after `ask:`, names in conditions, a coded
 * answer's codes where one is compared), adapted.
 * The banks are read when asked, so it offers what is loaded now.
 */
import {
	type Completion,
	type CompletionContext,
	type CompletionResult,
	snippetCompletion,
} from "@codemirror/autocomplete";

import type { BankScope } from "@qretools/core";
import { instrumentCompletion } from "@qretools/core/editor";
import { relativeSnippet } from "./complete.ts";

/** CodeMirror's icon for each kind of option. */
const TYPE = {
	question: "class",
	variable: "variable",
	name: "variable",
	code: "enum",
	field: "property",
	step: "keyword",
	snippet: "text",
} as const;

/** A code being typed: its quotes and what is between them. */
const CODE = /^"?[A-Za-z0-9_-]*"?$/;
/** A name being typed, dots included. */
const NAME = /^[A-Za-z0-9_.]*$/;

export function instrumentSource(
	banks: () => Readonly<Record<string, BankScope>>,
): (context: CompletionContext) => CompletionResult | null {
	return (context: CompletionContext): CompletionResult | null => {
		const found = instrumentCompletion(
			context.state.doc.toString(),
			context.pos,
			banks(),
		);
		// Unasked, only once a word is being typed: never a list after every space. The
		// one exception is where a code goes (after `=`, `<>`, `{` or `, ` beside a coded
		// answer, owner 2026-10-09): the codes open there at once.
		const codes = found?.options.every((o) => o.kind === "code") ?? false;
		// A field's text starts at the line's start: its indent is not a word typed.
		const typed =
			found !== undefined &&
			context.state.sliceDoc(found.from, context.pos).trim() !== "";
		if (
			found === undefined ||
			found.options.length === 0 ||
			(!context.explicit && !typed && !codes)
		)
			return null;
		return {
			from: found.from,
			...(found.to !== undefined && { to: found.to }),
			// Fields and steps come narrowed by the core, each with its own indent from the
			// line's start: shown as they are, never filtered again against the indent.
			...(found.filtered && { filter: false }),
			options: found.options.map((o): Completion => {
				const shown: Completion = {
					label: o.label,
					type: TYPE[o.kind],
					...(o.detail !== undefined && { detail: o.detail }),
					...(o.apply !== undefined && { apply: o.apply }),
				};
				if (o.snippet === undefined) return shown;
				const line = context.state.doc.lineAt(found.from);
				const base = /^ */.exec(line.text)?.[0] ?? "";
				// Tab steps through its places, Escape leaves (CodeMirror's snippet keys).
				return snippetCompletion(relativeSnippet(o.snippet, base), shown);
			}),
			// CodeMirror narrows the list itself while a name or a code is typed, and
			// asks again once the text is neither; a list the core narrowed is asked again
			// at every keystroke.
			...(!found.filtered && { validFor: codes ? CODE : NAME }),
		};
	};
}
