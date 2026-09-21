/**
 * A Draft is the core's view of a question: every field may still be a hole,
 * but what is present is typed, and impossible states are unrepresentable.
 * In particular the response domain is one tagged union, never three optional
 * fields that must be checked together.
 */

export interface Code {
	readonly code: string;
	readonly label: string;
}

export type Domain =
	| {
			readonly kind: "responses";
			/** In the author's order; a codebook lists options as written. */
			readonly codes: readonly Code[];
			readonly select: "one" | "many";
	  }
	| {
			readonly kind: "number";
			readonly min?: number;
			readonly max?: number;
			readonly unit?: string;
			readonly decimals?: number;
	  }
	| { readonly kind: "open"; readonly maxLength?: number };

export interface Draft {
	readonly name?: string;
	readonly text?: string;
	readonly intent?: string;
	readonly concept?: string;
	readonly universe?: string;
	readonly instruction?: string;
	readonly source?: string;
	/** Absent means a hole: no response domain yet. */
	readonly domain?: Domain;
}
