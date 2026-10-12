/**
 * The values a question fill may show to a respondent. This is assignment
 * compatibility, not conversion: a `number` fill needs a numeric value; a `text`
 * fill can show text, a coded answer's respondent-facing label, or a number.
 * `unknown` is accepted so the original missing/broken-value finding remains the
 * one useful error.
 */
import type { Type } from "../cond/type.ts";
import type { FillType } from "../surface/fills.ts";

export type FillCompatibility =
	| {
			readonly kind: "compatible";
			readonly presentation: "text" | "label" | "number";
	  }
	| { readonly kind: "incompatible"; readonly expected: "number" };

/** Whether a source value can fill a declared parameter, and how text presents it. */
export function fillCompatibility(
	want: FillType | undefined,
	got: Type,
): FillCompatibility {
	if (want === "number")
		return got.kind === "number" || got.kind === "unknown"
			? { kind: "compatible", presentation: "number" }
			: { kind: "incompatible", expected: "number" };
	// `text` is presentation: free text stays words, codes mean their response label,
	// and a numeric value has its ordinary numeric rendering.
	switch (got.kind) {
		case "code":
			return { kind: "compatible", presentation: "label" };
		case "number":
			return { kind: "compatible", presentation: "number" };
		default:
			return { kind: "compatible", presentation: "text" };
	}
}
