/**
 * Completion in an instrument, as CodeMirror asks for it: the core's
 * `instrumentCompletion` (bank questions after `ask:`, names in conditions, a coded
 * answer's codes where one is compared), adapted.
 * The banks are read when asked, so it offers what is loaded now.
 */
import type {
	Completion,
	CompletionContext,
	CompletionResult,
} from "@codemirror/autocomplete";
import type { BankScope } from "@qretools/core";
import { instrumentCompletion } from "@qretools/core/editor";

/** CodeMirror's icon for each kind of option. */
const TYPE = {
	question: "class",
	variable: "variable",
	name: "variable",
	code: "enum",
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
		// Unasked, only once a word is being typed: never a list after every space. A
		// code's word starts at its quote, so typing `"` opens the codes.
		if (
			found === undefined ||
			found.options.length === 0 ||
			(!context.explicit && found.from === context.pos)
		)
			return null;
		return {
			from: found.from,
			...(found.to !== undefined && { to: found.to }),
			options: found.options.map(
				(o): Completion => ({
					label: o.label,
					type: TYPE[o.kind],
					...(o.detail !== undefined && { detail: o.detail }),
					...(o.apply !== undefined && { apply: o.apply }),
				}),
			),
			// CodeMirror narrows the list itself while a name or a code is typed, and
			// asks again once the text is neither.
			validFor: found.options.every((o) => o.kind === "code") ? CODE : NAME,
		};
	};
}
