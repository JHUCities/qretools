/**
 * CodeMirror inside React. The component owns only the editor's lifecycle; the
 * editor object (editor.ts) owns the text while a keystroke is in flight, and
 * `sync` pushes the Model's text, diagnostics, marks and schema in. The handle is
 * registered with the effects so `revealRange` can reach it.
 */

import { type Fix, instrumentPath, remotesOf, WORKSPACE } from "@qretools/core";
import {
	bankChoices,
	choicesOf,
	domainSnippets,
	type Livelit,
	newLineAfter,
	questionChoices,
	type Source,
} from "@qretools/core/editor";
import {
	createEditor,
	type Editor,
	type EditorInputs,
	instrumentSource,
} from "@qretools/editor";
import { useLayoutEffect, useRef } from "react";
import { useApp } from "./AppContext.js";

/**
 * A question or shared file has its schema, which completion reads. An instrument has
 * none: completion offers the questions and names of the banks it uses instead
 * (`instrument`), read from the store when it asks, never as they were at mount; its
 * pickers offer the same questions, and the workspace's banks at `uses`.
 */
export function EditorPane(
	inputs: EditorInputs &
		(
			| {
					readonly schema: object;
					readonly instrument?: undefined;
					/** A question: its response domains are offered written out too. */
					readonly question?: true;
					/** A file with pickers of its own (a bank's details); a question always has them. */
					readonly pickers?: true;
			  }
			| {
					readonly schema?: undefined;
					readonly instrument: true;
					readonly question?: undefined;
					readonly pickers?: undefined;
			  }
		),
) {
	const host = useRef<HTMLDivElement>(null);
	const editor = useRef<Editor | null>(null);
	const { dispatch, effects, evaluations, store } = useApp();
	const instrument = inputs.instrument === true;
	const question = inputs.question === true;
	const pickers = question || inputs.pickers === true;
	// The open file's id when completion asks: the editor outlives a change of file.
	const open = useRef(inputs.id);
	open.current = inputs.id;
	useLayoutEffect(() => {
		if (!host.current) return;
		const scopes = () => {
			const { model } = store.getState();
			const e = model.local.workspace[open.current];
			return e?.kind === "instrument" ? evaluations.usedScopes(model, e) : {};
		};
		const e = createEditor(
			host.current,
			(text) => dispatch({ kind: "edited", text }),
			(offset) => dispatch({ kind: "cursorMoved", offset }),
			(id, offset) => dispatch({ kind: "definitionRequested", id, offset }),
			{
				...(instrument
					? { completions: [instrumentSource(scopes)], newLine: newLineAfter }
					: question && { snippets: domainSnippets }),
				// Pickers read the open file's bank (an instrument's, its banks) as they are
				// when one opens.
				...((pickers || instrument) && {
					livelit: {
						choices: (source: Source) => {
							const { model } = store.getState();
							if (source.kind === "questions") return questionChoices(scopes());
							if (source.kind === "banks")
								return bankChoices(
									WORKSPACE.instruments,
									model.banks,
									remotesOf(
										Object.fromEntries(
											Object.values(model.local.workspace).flatMap((w) =>
												w.kind === "instrument"
													? [[instrumentPath(w.name), w.source]]
													: [],
											),
										),
									),
								);
							const f =
								model.local.questions[open.current] ??
								model.local.schemes[open.current];
							return f === undefined || source.kind !== "scheme"
								? []
								: choicesOf(evaluations.env(model, f.bank), source.scheme);
						},
						choose: (livelit: Livelit, value: string | readonly string[]) =>
							dispatch({
								kind: "livelitChosen",
								id: open.current,
								livelit: livelit.id,
								value,
							}),
						act: (fix: Fix) =>
							dispatch({ kind: "fixApplied", id: open.current, fix }),
					},
				}),
			},
		);
		editor.current = e;
		effects.registerEditor(e);
		return () => {
			effects.registerEditor(undefined);
			e.destroy();
			editor.current = null;
		};
	}, [dispatch, effects, evaluations, store, instrument, question, pickers]);
	const { id, text, diagnostics, marks, schema, readOnly, label, livelits } =
		inputs;
	// Before paint: the first frame of a file already shows its text, never an empty
	// editor that fills a frame later.
	useLayoutEffect(() => {
		editor.current?.sync({
			id,
			text,
			diagnostics,
			marks,
			...(schema !== undefined && { schema }),
			...(readOnly !== undefined && { readOnly }),
			...(label !== undefined && { label }),
			...(livelits !== undefined && { livelits }),
		});
		if (editor.current) effects.editorSynced(id);
	}, [
		id,
		text,
		diagnostics,
		marks,
		schema,
		readOnly,
		label,
		livelits,
		effects,
	]);
	return <div ref={host} className="editor" />;
}
