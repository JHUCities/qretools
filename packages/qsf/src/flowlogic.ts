/** A condition's list of tests as Qualtrics logic: branch logic now, display logic later. */
import type { Atom, Dnf } from "./logic.ts";
import type { Ctx } from "./number.ts";
import type { Qsf, QsfObject } from "./skeleton.ts";

/** One Qualtrics test, as the owner's exports write it. */
const expression = (ctx: Ctx, a: Atom): QsfObject => {
	const right = a.value === undefined ? {} : { RightOperand: a.value };
	if (a.subject.kind === "field")
		return {
			LogicType: "EmbeddedField",
			LeftOperand: a.subject.name,
			Operator: a.op,
			...right,
			Type: "Expression",
			Description: "",
		};
	const qid = ctx.qidOf(a.subject.ask);
	const domain = ctx.numbering.questions.get(a.subject.ask)?.domain;
	const chosen = a.op === "Selected" || a.op === "NotSelected";
	// A choice is tested by its place in the question, its code being only the recode.
	const locator = chosen
		? `q://${qid}/SelectableChoice/${
				domain?.kind === "choice"
					? domain.choices.findIndex((c) => c.code === a.value) + 1
					: 0
			}`
		: `q://${qid}/ChoiceTextEntryValue`;
	// A looped question is read at the current round (experiment 3) or at one round from
	// outside its loop, its operand addressing that round's copy (experiment 7).
	const loop = ctx.numbering.loopOf.get(a.subject.ask);
	const row = a.subject.row;
	const where =
		loop === undefined
			? { QuestionIsInLoop: "no" }
			: {
					QuestionIsInLoop: "yes",
					LoopAndMergeLoops:
						row === undefined
							? "current"
							: `${ctx.numbering.loopBlocks.get(loop) ?? ""},${row}`,
					LoopTarget: "none",
				};
	return {
		LogicType: "Question",
		QuestionID: qid,
		...where,
		ChoiceLocator: locator,
		Operator: a.op,
		QuestionIDFromLocator: qid,
		LeftOperand:
			row === undefined
				? locator
				: locator.replace(`q://${qid}/`, `q://${row}_${qid}/`),
		...(chosen ? {} : right),
		Type: "Expression",
		Description: "",
	};
};
/** An Or of And-groups as Qualtrics' flat list: And binds first (experiment 2). */
export const logicOf = (ctx: Ctx, d: Dnf): Qsf => {
	const list = d.flatMap((group, g) =>
		group.map((a, k) => ({
			...expression(ctx, a),
			...((g > 0 || k > 0) && { Conjuction: k === 0 ? "Or" : "And" }),
		})),
	);
	return {
		"0": {
			...Object.fromEntries(list.map((x, k) => [String(k), x])),
			Type: "If",
		},
		Type: "BooleanExpression",
	};
};
