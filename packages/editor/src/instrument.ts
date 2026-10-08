/**
 * Completion in an instrument, as CodeMirror asks for it: the core's
 * `instrumentCompletion` (bank questions after `ask:`, names in conditions), adapted.
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
} as const;

export function instrumentSource(
	banks: () => Readonly<Record<string, BankScope>>,
): (context: CompletionContext) => CompletionResult | null {
	return (context: CompletionContext): CompletionResult | null => {
		const found = instrumentCompletion(
			context.state.doc.toString(),
			context.pos,
			banks(),
		);
		// Unasked, only once a word is being typed: never a list after every space.
		if (
			found === undefined ||
			found.options.length === 0 ||
			(!context.explicit && found.from === context.pos)
		)
			return null;
		return {
			from: found.from,
			options: found.options.map(
				(o): Completion => ({
					label: o.label,
					type: TYPE[o.kind],
					...(o.detail !== undefined && { detail: o.detail }),
				}),
			),
			// Names and dots: CodeMirror narrows the list itself while they are typed.
			validFor: /^[A-Za-z0-9_.]*$/,
		};
	};
}
