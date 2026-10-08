/**
 * An instrument's flow as an outline: one item per step, nested as the flow nests, each
 * labelled in parts the view only draws (a keyword, the author's words, a name as code,
 * or a hole where something is still to be written). A render model, as the codebook
 * view is: what an outline says is decided here, never in a view. Findings aren't in
 * it; a view can match them to items by path.
 */
import { UNNAMED } from "../copy.ts";
import type { InstrumentDraft, Node } from "./draft.ts";

/** A piece of an item's label. A hole names what is missing ("condition", "question"). */
export interface OutlinePart {
	readonly kind: "keyword" | "text" | "code" | "hole";
	readonly text: string;
}

export interface OutlineItem {
	/** A step's kind; an `if`'s `else if` and `else` follow it as items of their own. */
	readonly kind: Node["kind"] | "else";
	/** Its place in the source, as findings and ranges name places. */
	readonly path: string;
	readonly label: readonly OutlinePart[];
	/** For an `ask`: the question's title, or its text when it has none. */
	readonly detail?: string;
	readonly children: readonly OutlineItem[];
}

const keyword = (text: string): OutlinePart => ({ kind: "keyword", text });
const words = (text: string): OutlinePart => ({ kind: "text", text });
const code = (text: string): OutlinePart => ({ kind: "code", text });
const missing = (what: string): OutlinePart => ({ kind: "hole", text: what });
const named = (name: string | undefined): OutlinePart =>
	name === undefined ? missing(UNNAMED) : code(name);

export function outlineOf(draft: InstrumentDraft): readonly OutlineItem[] {
	return itemsOf(draft.flow);
}

const itemsOf = (nodes: readonly Node[]): readonly OutlineItem[] =>
	nodes.flatMap(itemOf);

/** A step's items: one, but an `if` is one per branch, as it is written. */
function itemOf(node: Node): OutlineItem | readonly OutlineItem[] {
	const item = (
		label: readonly OutlinePart[],
		children: readonly Node[] = [],
	): OutlineItem => ({
		kind: node.kind,
		path: node.path,
		label,
		children: itemsOf(children),
	});
	switch (node.kind) {
		case "ask": {
			const q = node.question;
			const detail = q?.evaluation.draft.title ?? q?.evaluation.draft.text;
			return {
				...item([
					keyword("Ask"),
					q === undefined ? missing("question") : code(`${q.alias}.${q.name}`),
					...(node.as === undefined ? [] : [keyword("as"), code(node.as)]),
				]),
				...(detail !== undefined && { detail }),
			};
		}
		case "say":
			return item([
				keyword("Say"),
				node.text === undefined ? missing("text") : words(node.text),
			]);
		case "section":
			return item(
				[
					keyword("Section"),
					node.title === undefined ? missing("title") : words(node.title),
				],
				node.flow,
			);
		case "if":
			// As it reads: `If` with its steps, then each `Else if` and the `Else` after it.
			return [
				...node.branches.map(
					(b, i): OutlineItem => ({
						kind: i === 0 ? "if" : "else",
						path: b.path,
						label: [
							keyword(i === 0 ? "If" : "Else if"),
							b.cond === undefined ? missing("condition") : code(b.cond.text),
						],
						children: itemsOf(b.then),
					}),
				),
				...(node.else === undefined
					? []
					: [
							{
								kind: "else" as const,
								// After the last `else if`, where the parser read it.
								path: `${node.branches.at(-1)?.path ?? node.path}.else`,
								label: [keyword("Else")],
								children: itemsOf(node.else),
							},
						]),
			];
		case "stop":
			// Its condition is required: without one it is a hole, never an unconditional stop.
			return item([
				keyword("Stop"),
				keyword("if"),
				node.cond === undefined ? missing("condition") : code(node.cond.text),
			]);
		case "compute":
			return item([
				keyword("Compute"),
				named(node.name),
				keyword("="),
				node.value === undefined ? missing("value") : code(node.value.text),
			]);
		case "roster":
			return item([keyword("Roster"), named(node.name)], node.flow);
		case "each":
			return item(
				[
					keyword("Each row of"),
					node.roster === undefined ? missing("roster") : code(node.roster),
				],
				node.flow,
			);
		case "hole":
			return item([missing("step")]);
		default:
			return node satisfies never;
	}
}
