/** A read flow as lines of text, for tests to compare whole. */
import { printCondition } from "../cond/print.ts";
import type { Cond, Part, Source, Step } from "./read.ts";

/** A read flow as lines of text, to compare whole. */
export const source = (s: Source): string =>
	s.kind === "answer"
		? `${s.variable}${s.option === undefined ? "" : `#${s.option.code}/${s.option.ticked}`}${s.asks.length > 1 ? `x${s.asks.length}` : ""}`
		: s.kind === "row"
			? `row(${s.loop.split(".").at(-1)})`
			: `${s.kind}:${s.variable}`;
export const cond = (c: Cond): string =>
	`${printCondition(c.expr)} {${[...c.sources].map(([a, s]) => `${a}=${source(s)}`).join(", ")}}`;
export const text = (t: readonly Part[]): string =>
	t
		.map((p) =>
			p.kind === "text"
				? p.text
				: `<${source(p.source)}${p.label ? ":label" : ""}>`,
		)
		.join("");
export const outline = (steps: readonly Step[], ind = ""): string[] =>
	steps.flatMap((s): string[] => {
		switch (s.kind) {
			case "ask":
				return [
					`${ind}ask ${s.question.name} ${s.question.domain.kind}${s.question.domain.kind === "choice" && s.question.domain.many ? "*" : ""} ${s.records.map((r) => r.variable + (r.code === undefined ? "" : `#${r.code}`)).join(",")}${s.options ? ` ${s.options}` : ""}: ${text(s.text)}`,
					...s.checks.map(
						(c) =>
							`${ind}  check ${c.severity} ${cond(c.ensure)}${c.message ? `: ${text(c.message)}` : ""}`,
					),
				];
			case "say":
				return [`${ind}say ${text(s.text)}`];
			case "compute":
				return [`${ind}compute ${s.variable} = ${cond(s.value)}`];
			case "stop":
				return [`${ind}stop ${cond(s.cond)}`, ...outline(s.say, `${ind}  `)];
			case "if":
				return [
					...s.branches.flatMap((b, i) => [
						`${ind}${i === 0 ? "if" : "elif"} ${cond(b.cond)}`,
						...outline(b.then, `${ind}  `),
					]),
					...(s.else === undefined
						? []
						: [`${ind}else`, ...outline(s.else, `${ind}  `)]),
				];
			case "loop":
				return [
					`${ind}loop count ${cond(s.count)} max ${s.max}`,
					...outline(s.flow, `${ind}  `),
				];
			case "repeat":
				return [
					`${ind}repeat more ${cond(s.more)} max ${s.max}`,
					...outline(s.flow, `${ind}  `),
				];
			case "section":
				return [
					`${ind}section ${s.title ?? ""} ${s.order ?? ""}`.trimEnd(),
					...outline(s.flow, `${ind}  `),
				];
			default:
				return s satisfies never;
		}
	});
