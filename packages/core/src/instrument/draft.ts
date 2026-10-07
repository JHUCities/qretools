/**
 * An instrument, read: what it imports, what it receives, and its flow. Like a question's
 * Draft, every part may still be a hole; what is present is typed, and a name that
 * resolves carries what it resolved to, so later passes never look it up again.
 */
import type { Expr } from "../cond/ast.ts";
import type { Type } from "../cond/type.ts";
import type { Evaluation } from "../evaluate.ts";
import type { Range } from "../findings.ts";
import type { Code } from "../surface/draft.ts";

/** A bank imported under an alias; the address is the resolver's, never read here. */
export interface Use {
	readonly alias: string;
	readonly address?: string;
}

/** What an input or answer holds, in the question language's terms. */
export type ValueDomain =
	| {
			readonly kind: "responses";
			readonly codes: readonly Code[];
			/** A bank's shared scale, qualified (`bas.agree4`), when the codes came from one. */
			readonly scale?: string;
	  }
	| {
			readonly kind: "number";
			readonly min?: number;
			readonly max?: number;
			readonly decimals?: number;
	  }
	| { readonly kind: "open"; readonly maxLength?: number };

/** A value from outside, known before the interview: a name and a type. */
export interface Input {
	readonly name: string;
	readonly path: string;
	/** Absent while it's a hole. */
	readonly domain?: ValueDomain;
	readonly description?: string;
}

/**
 * A condition or computed value as written: its text, and its expression, whose ranges
 * are offsets in the instrument's source (mapped through the YAML scalar holding it).
 */
export interface Cond {
	readonly text: string;
	readonly expr: Expr;
}

/** A bank question an `ask` names, resolved. */
export interface QuestionRef {
	readonly alias: string;
	readonly name: string;
	/** Its file in the bank. */
	readonly path: string;
	readonly evaluation: Evaluation;
}

/** What fills a bank question's fill, at this ask. */
export interface FillBinding {
	readonly name: string;
	readonly path: string;
	readonly source?: Cond;
}

export type Severity = "info" | "warning" | "blocking";
export const SEVERITIES: readonly Severity[] = ["info", "warning", "blocking"];

/** A `{{name}}` in a statement or message: the name, and where the placeholder is in the source. */
export interface Placeholder {
	readonly name: string;
	readonly range: Range;
}

/** What must be true of the answers once this question is answered, and what to say if not. */
export interface Check {
	readonly path: string;
	readonly name?: string;
	readonly ensure?: Cond;
	readonly severity?: Severity;
	readonly message?: string;
	/** The message's placeholders, which read names as conditions do. */
	readonly messageReads: readonly Placeholder[];
}

/** A universe: a bank's shared one by name (qualified), or prose. */
export type UniverseRef =
	| { readonly kind: "text"; readonly text: string }
	| {
			readonly kind: "ref";
			readonly alias: string;
			readonly name: string;
			readonly text: string;
	  };

export type Order = "random" | "rotate";

export type Node =
	| {
			readonly kind: "ask";
			readonly path: string;
			/** Absent while the name is a hole or names nothing. */
			readonly question?: QuestionRef;
			/** The name its answer is stored under when the question is asked again. */
			readonly as?: string;
			readonly universe?: UniverseRef;
			readonly options?: Order;
			readonly seconds?: number;
			readonly fills: readonly FillBinding[];
			readonly checks: readonly Check[];
	  }
	| {
			readonly kind: "say";
			readonly path: string;
			readonly text?: string;
			readonly reads: readonly Placeholder[];
	  }
	| {
			readonly kind: "section";
			readonly path: string;
			readonly title?: string;
			readonly order?: Order;
			readonly flow: readonly Node[];
	  }
	| {
			readonly kind: "if";
			readonly path: string;
			/** The `if` and each `else if`, in order. */
			readonly branches: readonly {
				readonly path: string;
				readonly cond?: Cond;
				readonly then: readonly Node[];
			}[];
			readonly else?: readonly Node[];
	  }
	| {
			readonly kind: "stop";
			readonly path: string;
			readonly cond?: Cond;
			readonly say?: string;
			readonly sayReads: readonly Placeholder[];
	  }
	| {
			readonly kind: "compute";
			readonly path: string;
			readonly name?: string;
			readonly value?: Cond;
	  }
	| {
			/**
			 * The respondent lists things, one row each: as many as `count` says (asked
			 * first), or while `more` is true (asked as each row's last question).
			 */
			readonly kind: "roster";
			readonly path: string;
			readonly name?: string;
			readonly end?:
				| { readonly kind: "count"; readonly value?: Cond }
				| { readonly kind: "more"; readonly cond?: Cond };
			readonly flow: readonly Node[];
	  }
	| {
			/** Over an earlier roster's rows, again: its questions mean this row's answers. */
			readonly kind: "each";
			readonly path: string;
			readonly roster?: string;
			readonly flow: readonly Node[];
	  }
	| {
			/** Written, but nothing here is a step yet: a hole in the flow. */
			readonly kind: "hole";
			readonly path: string;
	  };

export interface InstrumentDraft {
	readonly name?: string;
	readonly title?: string;
	readonly description?: string;
	readonly universe?: UniverseRef;
	readonly uses: readonly Use[];
	readonly inputs: readonly Input[];
	readonly flow: readonly Node[];
}

/**
 * What a name in a condition or fill means: a bank variable, an input, a compute, an
 * `as`, or a roster's row number (`members.index`; plain `index` is the innermost
 * roster's, and is read as that).
 */
export type Named =
	| {
			readonly kind: "index";
			readonly roster: string;
			readonly name: string;
			readonly type: Type;
	  }
	| {
			readonly kind: "bank";
			readonly alias: string;
			/** The variable's own name in the bank (`nhd_sat`, or an option's `race_w`). */
			readonly variable: string;
			readonly question: QuestionRef;
			readonly type: Type;
	  }
	| { readonly kind: "input"; readonly input: Input; readonly type: Type }
	| {
			readonly kind: "compute";
			readonly name: string;
			readonly path: string;
			readonly type: Type;
	  }
	| {
			readonly kind: "as";
			readonly name: string;
			readonly path: string;
			/** Absent while the question it asks again doesn't resolve. */
			readonly question?: QuestionRef;
			readonly type: Type;
	  };
