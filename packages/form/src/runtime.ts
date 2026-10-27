/// <reference lib="dom" />
/**
 * The form's runtime, in the page: the imperative shell around `walk`. Its state is a
 * `Run` (and which instrument); every change replaces the run and draws the page again
 * from `walk`. Shuffles and random answers are drawn here, never in `walk`.
 *
 * Self-contained, as `walk` is: the page runs it from its source text, so it names
 * nothing outside itself but its arguments and the browser's globals.
 */
import type {
	Choice,
	evaluateCondition,
	FlowDomain,
	FlowStep,
	ReadInstruments,
} from "@qretools/core";
import type { Answer, Event, Place, Run, Walked, walk } from "./walk.ts";

export function runtime(
	evaluate: typeof evaluateCondition,
	walkOf: typeof walk,
	read: ReadInstruments,
): void {
	type Child = Node | string | false | undefined;
	const h = (
		tag: string,
		attrs: Record<string, string | boolean> = {},
		...kids: Child[]
	): HTMLElement => {
		const el = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs)) {
			if (v === true) el.setAttribute(k, "");
			else if (v !== false) el.setAttribute(k, v);
		}
		for (const k of kids) if (k !== false && k !== undefined) el.append(k);
		return el;
	};
	// Text that isn't a number is no answer, never NaN.
	const numberOf = (t: string): Answer =>
		Number.isFinite(Number(t)) ? Number(t) : null;
	const byId = (id: string) => document.getElementById(id) as HTMLElement;

	// --- a run's shuffles, drawn when it starts ---
	const shuffled = (n: number): number[] => {
		const a = [...Array(n).keys()];
		for (let j = n - 1; j > 0; j--) {
			const k = Math.floor(Math.random() * (j + 1));
			[a[j], a[k]] = [a[k] ?? 0, a[j] ?? 0];
		}
		return a;
	};
	const rotated = (n: number): number[] => {
		const k = Math.floor(Math.random() * n);
		return [...Array(n).keys()].map((j) => (j + k) % n);
	};
	// DDI's ItemSequenceType as written: `Random` shuffles, `Rotate` rotates, anything else keeps the order.
	const draw = (type: string | undefined, n: number): number[] | undefined =>
		type?.toLowerCase() === "random"
			? shuffled(n)
			: type?.toLowerCase() === "rotate"
				? rotated(n)
				: undefined;
	const children = (s: FlowStep): readonly (readonly FlowStep[])[] => {
		switch (s.kind) {
			case "if":
				return [...s.branches.map((b) => b.then), s.else ?? []];
			case "stop":
				return [s.say, s.else];
			case "section":
			case "count":
			case "repeat":
			case "loop":
				return [s.flow];
			default:
				return [];
		}
	};
	const ordersOf = (
		steps: readonly FlowStep[],
		out: Record<string, number[]> = {},
	): Record<string, number[]> => {
		for (const s of steps) {
			const order =
				s.kind === "section"
					? draw(s.order, s.flow.length)
					: s.kind === "ask" && s.question.domain.kind === "choice"
						? draw(s.responseOrder, s.question.domain.choices.length)
						: undefined;
			if (order !== undefined) out[s.id] = order;
			for (const flow of children(s)) ordersOf(flow, out);
		}
		return out;
	};

	// --- words for values ---
	const choicesOf: Record<string, readonly Choice[]> = {};
	const index = (steps: readonly FlowStep[]) => {
		for (const s of steps) {
			const v = s.kind === "ask" ? s.records[0]?.variable : undefined;
			if (
				v !== undefined &&
				s.kind === "ask" &&
				s.question.domain.kind === "choice"
			)
				choicesOf[v] = s.question.domain.choices;
			for (const flow of children(s)) index(flow);
		}
	};
	for (const instrument of read.instruments) index(instrument.flow);
	for (const input of read.inputs)
		if (input.domain?.kind === "choice")
			choicesOf[input.variable] = input.domain.choices;
	const said = (key: string, v: Answer | boolean): string => {
		if (v === null) return "no answer";
		if (typeof v === "boolean") return v ? "true" : "false";
		const c = choicesOf[key.replace(/\[.*$/, "")]?.find((c) => c.code === v);
		return c === undefined ? String(v) : `${c.label} (${c.code})`;
	};

	// --- state ---
	const fresh = (k: number): { which: number; run: Run | undefined } => ({
		which: k,
		run: undefined,
	});
	let state = fresh(0);
	const instrument = () => read.instruments[state.which] ?? read.instruments[0];
	const walked = (run: Run): Walked => {
		const flow = instrument();
		return flow === undefined
			? { held: {}, trail: [], ended: "end", asked: 0 }
			: walkOf(flow, run, evaluate, 100);
	};
	const start = (inputs: Record<string, Answer>) => {
		state = {
			...state,
			run: { inputs, answers: [], orders: ordersOf(instrument()?.flow ?? []) },
		};
	};
	const randomInputs = (): Record<string, Answer> =>
		Object.fromEntries(
			read.inputs.map((i) => [
				i.variable,
				i.domain?.kind === "choice"
					? (i.domain.choices[
							Math.floor(Math.random() * i.domain.choices.length)
						]?.code ?? null)
					: null,
			]),
		);
	const randomAnswer = (d: FlowDomain): Answer => {
		if (Math.random() < 0.05) return null; // now and then, no answer
		if (d.kind === "choice")
			return (
				d.choices[Math.floor(Math.random() * d.choices.length)]?.code ?? null
			);
		if (d.kind === "number") {
			const lo = d.min ?? 0;
			const hi = d.max ?? lo + 10;
			return lo + Math.floor(Math.random() * (hi - lo + 1));
		}
		return "A typed answer";
	};

	const main = byId("screen");
	const panel = byId("panel");
	const live = byId("live");

	const render = (announce: boolean) => {
		const w = state.run === undefined ? undefined : walked(state.run);
		main.replaceChildren(
			w === undefined
				? startScreen()
				: w.current !== undefined
					? questionScreen(w.current)
					: endScreen(w),
		);
		panel.replaceChildren(...sidePanel(w));
		if (!announce) return;
		main.querySelector<HTMLElement>("h2")?.focus();
		live.textContent =
			w === undefined
				? ""
				: w.current !== undefined
					? `${w.asked} answered. ${w.current.step.kind === "ask" ? `Question ${w.current.n}` : "A statement"}.`
					: `${w.ended === "stopped" ? "Screened out" : "The end"}. ${w.asked} questions asked.`;
	};

	const startScreen = (): Node => {
		const form = h(
			"form",
			{ class: "card" },
			h("h2", { tabindex: "-1" }, "Before the survey"),
		);
		if (read.instruments.length > 1)
			form.append(
				h(
					"fieldset",
					{},
					h("legend", {}, "Instrument"),
					...read.instruments.map((ins, k) =>
						h(
							"label",
							{ class: "choice" },
							h("input", {
								type: "radio",
								name: "instrument",
								value: String(k),
								checked: k === state.which,
							}),
							ins.label ?? ins.name ?? ins.id,
						),
					),
				),
			);
		if (read.inputs.length > 0)
			form.append(
				h(
					"p",
					{ class: "muted" },
					"These values come with the sample, not from the respondent. Choose them, or leave them to chance.",
				),
			);
		for (const input of read.inputs) {
			const d = input.domain;
			form.append(
				d?.kind === "choice"
					? h(
							"fieldset",
							{},
							h("legend", {}, h("code", {}, input.variable)),
							...[{ code: "", label: "At random" }, ...d.choices].map((c, j) =>
								h(
									"label",
									{ class: "choice" },
									h("input", {
										type: "radio",
										name: input.variable,
										value: c.code,
										checked: j === 0,
									}),
									c.label,
									c.code === "" ? "" : h("span", { class: "code" }, c.code),
								),
							),
						)
					: h(
							"label",
							{ class: "field" },
							h("code", {}, input.variable),
							h("input", {
								name: input.variable,
								type: d?.kind === "number" ? "number" : "text",
							}),
						),
			);
		}
		form.append(
			h(
				"div",
				{ class: "actions" },
				h("button", { type: "submit", class: "primary" }, "Start"),
			),
		);
		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const fd = new FormData(form as HTMLFormElement);
			state = fresh(Number(fd.get("instrument") ?? state.which));
			const drawn = randomInputs();
			start(
				Object.fromEntries(
					read.inputs.map((i) => {
						const v = String(fd.get(i.variable) ?? "").trim();
						if (v === "") return [i.variable, drawn[i.variable] ?? null];
						return [i.variable, i.domain?.kind === "number" ? numberOf(v) : v];
					}),
				),
			);
			render(true);
		});
		return form;
	};

	const questionScreen = (at: Place): Node => {
		const s = at.step;
		const form = h(
			"form",
			{ class: "card" },
			h("p", { class: "eyebrow" }, at.sections.join(" › ")),
			h(
				"h2",
				{ tabindex: "-1" },
				s.kind === "ask" ? `Question ${at.n}` : "Statement",
				s.kind === "ask" ? h("code", { class: "name" }, s.question.name) : "",
			),
		);
		if (s.kind === "say") form.append(h("p", { class: "qtext" }, at.text));
		else {
			const d = s.question.domain;
			const fs = h("fieldset", {}, h("legend", { class: "qtext" }, at.text));
			if (d.kind === "choice") {
				const order = state.run?.orders[s.id] ?? d.choices.map((_, j) => j);
				for (const j of order) {
					const c = d.choices[j];
					if (c !== undefined)
						fs.append(
							h(
								"label",
								{ class: "choice" },
								h("input", { type: "radio", name: "a", value: c.code }),
								c.label,
								h("span", { class: "code" }, c.code),
							),
						);
				}
			} else {
				const attrs: Record<string, string> =
					d.kind === "number"
						? {
								type: "number",
								step: d.decimals > 0 ? String(10 ** -d.decimals) : "1",
								...(d.min !== undefined && { min: String(d.min) }),
								...(d.max !== undefined && { max: String(d.max) }),
							}
						: {
								type: "text",
								...(d.maxLength !== undefined && {
									maxlength: String(d.maxLength),
								}),
							};
				fs.append(
					h(
						"label",
						{ class: "field" },
						"Answer",
						h("input", { name: "t", ...attrs }),
					),
				);
			}
			form.append(
				fs,
				h(
					"p",
					{ class: "muted small" },
					"Next with no answer records no answer.",
				),
			);
		}
		form.append(
			h(
				"div",
				{ class: "actions" },
				h("button", { type: "button", "data-back": true }, "Back"),
				h("button", { type: "submit", class: "primary" }, "Next"),
			),
		);
		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const run = state.run;
			if (run === undefined) return;
			const fd = new FormData(form as HTMLFormElement);
			const a = fd.get("a");
			const t = String(fd.get("t") ?? "").trim();
			let value: Answer = null;
			if (a !== null) value = String(a);
			else if (t !== "")
				value =
					s.kind === "ask" && s.question.domain.kind === "number"
						? numberOf(t)
						: t;
			state = { ...state, run: { ...run, answers: [...run.answers, value] } };
			render(true);
		});
		form.querySelector("[data-back]")?.addEventListener("click", back);
		return form;
	};

	const back = () => {
		const run = state.run;
		state = {
			...state,
			run:
				run === undefined || run.answers.length === 0
					? undefined
					: { ...run, answers: run.answers.slice(0, -1) },
		};
		render(true);
	};

	const endScreen = (w: Walked): Node => {
		const card = h(
			"section",
			{ class: "card" },
			h(
				"h2",
				{ tabindex: "-1" },
				w.ended === "stopped" ? "Screened out" : "The end",
			),
			h(
				"p",
				{},
				`${w.asked} question${w.asked === 1 ? "" : "s"} asked on this route. The route is beside this.`,
			),
			h(
				"div",
				{ class: "actions" },
				h("button", { type: "button", "data-back": true }, "Back"),
			),
		);
		card.querySelector("[data-back]")?.addEventListener("click", back);
		return card;
	};

	const eventItem = (e: Event): Node => {
		switch (e.kind) {
			case "ask":
				return h(
					"li",
					{ class: "ask" },
					h("span", { class: "n" }, String(e.n)),
					h("code", {}, e.key),
					" ",
					h(
						"span",
						{ class: e.value === null ? "muted" : "" },
						said(e.key, e.value),
					),
				);
			case "say":
				return h("li", { class: "event" }, "Statement");
			case "compute":
				return h(
					"li",
					{ class: "event" },
					"Worked out ",
					h("code", {}, e.key),
					` = ${said(e.key, e.value)}`,
				);
			case "branch":
				return h(
					"li",
					{ class: e.taken ? "event" : "event skip" },
					e.taken ? "Took " : "Skipped ",
					h("code", {}, e.words),
				);
			case "section":
				return h(
					"li",
					{ class: "section" },
					e.title,
					e.members === undefined
						? ""
						: h(
								"span",
								{ class: "muted small" },
								` in this order: ${e.members.join(", ")}`,
							),
				);
			case "row":
				return h("li", { class: "event" }, `Row ${e.row}`);
			case "stop":
				return h(
					"li",
					{ class: "event skip" },
					"Screened out: ",
					h("code", {}, e.words),
				);
			default:
				return h("li", { class: "event note" }, e.text);
		}
	};

	const sidePanel = (w: Walked | undefined): Node[] => {
		const out: Node[] = [];
		const why = w?.current?.why;
		if (why !== undefined)
			out.push(
				h("h2", {}, "Why this is asked"),
				why.length === 0
					? h("p", {}, "Everyone is asked it.")
					: h(
							"div",
							{},
							h("p", {}, "Because all of these hold:"),
							h("ul", {}, ...why.map((c) => h("li", {}, h("code", {}, c)))),
						),
			);
		out.push(h("h2", {}, "Values"));
		const held = Object.entries(w?.held ?? {});
		out.push(
			held.length === 0
				? h("p", { class: "muted" }, "None yet.")
				: h(
						"dl",
						{ class: "values" },
						...held.flatMap(([k, v]) => [
							h("dt", {}, h("code", {}, k)),
							h("dd", {}, said(k, v)),
						]),
					),
		);
		out.push(h("h2", {}, "Route so far"));
		out.push(
			w === undefined || w.trail.length === 0
				? h("p", { class: "muted" }, "Nothing yet.")
				: h("ol", { class: "path" }, ...w.trail.map(eventItem)),
		);
		return out;
	};

	byId("restart").addEventListener("click", () => {
		state = fresh(state.which);
		render(true);
	});
	byId("random").addEventListener("click", () => {
		if (state.run === undefined) start(randomInputs());
		for (let guard = 0; guard < 10000 && state.run !== undefined; guard++) {
			const run: Run = state.run;
			const at = walked(run).current;
			if (at === undefined) break;
			const answer =
				at.step.kind === "ask" ? randomAnswer(at.step.question.domain) : null;
			state = { ...state, run: { ...run, answers: [...run.answers, answer] } };
		}
		render(true);
	});
	render(false);
}
