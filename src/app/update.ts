import { evaluate } from "../core/evaluate.js";
import { locate } from "../core/findings.js";
import type { Cmd, Model, Msg } from "./model.js";

/** Pure. Every state change in the app is one case here. */
export function update(
	model: Model,
	msg: Msg,
): readonly [Model, readonly Cmd[]] {
	switch (msg.kind) {
		case "edited":
		case "exampleChosen":
			return [{ ...model, source: msg.text }, []];
		case "locationClicked": {
			// A click names a place in the document's terms. It becomes a range here,
			// against the text as it is now: a range captured when a pane was drawn
			// goes stale as soon as the author types above it.
			const { ranges } = evaluate(model.source, model.agency);
			return [
				model,
				[{ kind: "revealRange", range: locate(msg.target, ranges) }],
			];
		}
		case "ddiSchemaLoaded":
			return [{ ...model, ddiSchema: msg.result }, []];
		default:
			return msg satisfies never;
	}
}
