/**
 * Where each character of a YAML scalar's value is in the source. A condition is
 * parsed from the value, and its findings name offsets in it; the editor needs them in
 * the source, which differs for a quoted scalar (its quotes, `\"`, `''`) and a folded
 * one (a line break read as a space). Total: when the value can't be aligned with the
 * source, every range maps to the whole scalar, never to a wrong place.
 */
import { Scalar } from "yaml";
import type { Range } from "../findings.ts";

const SPACE = /\s/;

export function scalarMap(
	source: string,
	node: Scalar,
	value: string,
): (local: Range) => Range {
	const [start, end] = node.range ?? [0, 0];
	const whole: Range = [start, end];
	const from =
		node.type === Scalar.QUOTE_DOUBLE || node.type === Scalar.QUOTE_SINGLE
			? start + 1
			: start;
	// Greedy alignment: each value character at the next source character that can be it.
	const at: number[] = [];
	let j = from;
	// By UTF-16 unit, as ranges count: one astral character is two of them.
	for (let i = 0; i < value.length; i++) {
		const ch = value[i] ?? "";
		while (
			j < end &&
			!(source[j] === ch || (SPACE.test(ch) && SPACE.test(source[j] ?? "")))
		)
			j++;
		if (j >= end) return () => whole;
		at.push(j);
		j++;
	}
	return ([a, b]) => {
		if (value.length === 0) return [from, from];
		const first = at[Math.min(a, value.length - 1)] ?? start;
		const left =
			a >= value.length ? (at[value.length - 1] ?? start) + 1 : first;
		const right =
			b > a ? (at[Math.min(b, value.length) - 1] ?? start) + 1 : left;
		return [left, right];
	};
}
