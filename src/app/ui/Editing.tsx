/**
 * The open file: a question, or a scheme file. Each is its source in the editor and
 * everything derived from it beside it. Bank-level findings (a variable defined
 * twice) come from the index and are shown on the file like any other finding.
 */
import { useMemo } from "react";
import { status, type Target } from "../../core/findings.js";
import {
	labelsJsonSchema,
	textEntryJsonSchema,
} from "../../core/surface/schema.js";
import {
	bankFindings,
	explainUnsaved,
	type Index,
	mentionKey,
	usedBy,
} from "../../core/symbols.js";
import { toDiagnostics } from "../diagnostics.js";
import { isUnsaved } from "../merge.js";
import type { Id, Question, SchemeEntry } from "../model.js";
import { useApp, useEnv, useModel } from "./AppContext.js";
import { EditorPane } from "./EditorPane.js";
import { FileHeader } from "./FileHeader.js";
import {
	Codebook,
	Ddi,
	Findings,
	Respondent,
	StatusBadge,
} from "./Previews.js";

/** JSON Schemas for scheme files never change, so they are made once. */
const SCHEME_SCHEMAS = {
	labels: labelsJsonSchema(),
	text: textEntryJsonSchema(),
};

export function Editing({ id, index }: { id: Id; index: Index<Id> }) {
	const entry = useModel((m) => m.files[id]);
	if (!entry) return null;
	return entry.kind === "question" ? (
		<QuestionEditing q={entry} index={index} />
	) : (
		<SchemeEditing e={entry} index={index} />
	);
}

function useActions(id: Id) {
	const { dispatch } = useApp();
	return {
		dispatch,
		onTarget: (target: Target) => dispatch({ kind: "locationClicked", target }),
		on: {
			save: () => dispatch({ kind: "saveRequested", id }),
			reload: () => dispatch({ kind: "reloadRequested", id }),
			remove: () => dispatch({ kind: "deleteRequested", id }),
			downloadYaml: () =>
				dispatch({ kind: "downloadRequested", id, format: "yaml" }),
			downloadDdi: () =>
				dispatch({ kind: "downloadRequested", id, format: "ddi" }),
		},
	};
}

function QuestionEditing({ q, index }: { q: Question; index: Index<Id> }) {
	const { evaluations, effects } = useApp();
	const agency = useModel((m) => m.agency);
	const session = useModel((m) => m.session);
	const ddiSchema = useModel((m) => m.ddiSchema);
	const files = useModel((m) => m.files);
	const env = useEnv();
	const { onTarget, on } = useActions(q.id);
	const ev = evaluations.get(q, agency, env);
	const findings = useMemo(() => {
		// Another file's name, as a bank-level finding cites it.
		const label = (id: Id): string => {
			const other = files[id];
			if (!other) return "?";
			if (other.kind !== "question") return other.name;
			return (
				evaluations.get(other, agency, env).draft.name ??
				(other.origin.kind === "bank" ? other.origin.path : `draft ${id}`)
			);
		};
		// Scheme files that exist here but not on GitHub, which questions cannot yet use.
		const unsaved = new Set(
			Object.values(files).flatMap((e) =>
				e.kind !== "question" &&
				e.kind !== "missing" &&
				e.origin.kind === "draft"
					? [mentionKey(e.kind, e.name)]
					: [],
			),
		);
		return [
			...explainUnsaved(ev.findings, ev.symbols.mentions, unsaved),
			...bankFindings(q.id, ev.symbols, index, label),
		];
	}, [ev, index, q.id, files, evaluations, agency, env]);
	const diagnostics = useMemo(
		() => toDiagnostics(findings, ev.ranges),
		[findings, ev.ranges],
	);
	const problems =
		ddiSchema.kind === "failed"
			? [ddiSchema.finding]
			: (effects.validate(ev.ddi) ?? []);
	return (
		<div className="editing">
			<FileHeader
				q={q}
				name={ev.draft.name}
				unsaved={isUnsaved(q)}
				session={session}
				on={on}
			/>
			<div className="split">
				<section className="left" aria-label="Question source">
					<EditorPane
						id={q.id}
						text={q.source}
						diagnostics={diagnostics}
						schema={evaluations.schema(env)}
					/>
				</section>
				<section className="right">
					<article className="pane">
						<h2>
							Findings <StatusBadge status={status(findings)} />
						</h2>
						<div className="pane-body">
							<Findings findings={findings} onTarget={onTarget} />
						</div>
					</article>
					<article className="pane">
						<h2>As the respondent sees it</h2>
						<div className="pane-body">
							<Respondent view={ev.respondent} onTarget={onTarget} />
						</div>
					</article>
					<article className="pane">
						<h2>Codebook entry</h2>
						<div className="pane-body">
							<Codebook view={ev.codebook} onTarget={onTarget} />
						</div>
					</article>
					<Ddi document={ev.ddi} schema={ddiSchema} problems={problems} />
				</section>
			</div>
		</div>
	);
}

const SINGULAR: Readonly<Record<SchemeEntry["kind"], string>> = {
	scale: "scale",
	universe: "universe",
	instruction: "instruction",
	missing: "missing values",
};

function SchemeEditing({ e, index }: { e: SchemeEntry; index: Index<Id> }) {
	const { evaluations } = useApp();
	const session = useModel((m) => m.session);
	const files = useModel((m) => m.files);
	const agency = useModel((m) => m.agency);
	const env = useEnv();
	const { dispatch, onTarget, on } = useActions(e.id);
	const ev = evaluations.scheme(e, env);
	const diagnostics = useMemo(
		() => toDiagnostics(ev.findings, ev.ranges),
		[ev],
	);
	const users =
		e.kind === "missing"
			? undefined
			: [...new Set(usedBy(index, e.kind, e.name).map((s) => s.key))];
	const saved = e.origin.kind === "bank" && !isUnsaved(e);
	// Whether questions naming this file resolve: only a saved, readable file is in effect.
	const inEffect =
		e.kind === "missing"
			? env.missing.length > 0
			: e.kind === "scale"
				? env.scales[e.name] !== undefined
				: (e.kind === "universe" ? env.universes : env.instructions)[e.name] !==
					undefined;
	return (
		<div className="editing">
			<FileHeader
				q={e}
				name={e.name}
				kind={SINGULAR[e.kind]}
				unsaved={isUnsaved(e)}
				session={session}
				on={{ ...on, downloadDdi: undefined }}
			/>
			<div className="split">
				<section className="left" aria-label={`${SINGULAR[e.kind]} source`}>
					<EditorPane
						id={e.id}
						text={e.source}
						diagnostics={diagnostics}
						schema={
							e.kind === "universe" || e.kind === "instruction"
								? SCHEME_SCHEMAS.text
								: SCHEME_SCHEMAS.labels
						}
					/>
				</section>
				<section className="right">
					<article className="pane">
						<h2>
							Findings <StatusBadge status={status(ev.findings)} />
						</h2>
						<div className="pane-body">
							<Findings findings={ev.findings} onTarget={onTarget} />
						</div>
					</article>
					<article className="pane">
						<h2>{SINGULAR[e.kind]}</h2>
						<div className="pane-body">
							{ev.value === undefined ? (
								<p className="quiet">Nothing readable yet.</p>
							) : ev.value.kind === "text" ? (
								<p>{ev.value.text}</p>
							) : (
								<ul className="cb-values">
									{ev.value.codes.map((c, i) => (
										// Codes may repeat while being edited, so the position is the key.
										// biome-ignore lint/suspicious/noArrayIndexKey: see above
										<li key={i}>
											<code>{c.code}</code> {c.label}
										</li>
									))}
								</ul>
							)}
							{!saved && (
								<p className="quiet">
									Questions read the saved version
									{e.origin.kind === "draft"
										? "; this one is not saved yet"
										: ""}
									. Save to share this change with them.
								</p>
							)}
						</div>
					</article>
					<article className="pane">
						<h2>
							{users === undefined ? "Used by" : `Used by ${users.length}`}
						</h2>
						<div className="pane-body">
							{users === undefined ? (
								<p className="quiet">
									Every variable in the bank references the missing-value list.
								</p>
							) : users.length === 0 ? (
								<p className="quiet">No question names it.</p>
							) : !inEffect ? (
								<p className="fg-attention">
									Not in effect (never saved, or its saved version does not
									read), so each of these shows a hole where it names{" "}
									<code>{e.name}</code>.
								</p>
							) : null}
							{users !== undefined && users.length > 0 && (
								<ul className="used-by">
									{users.map((id) => {
										const q = files[id];
										const name =
											q?.kind === "question"
												? evaluations.get(q, agency, env).draft.name
												: undefined;
										return (
											<li key={id}>
												<button
													type="button"
													className="linklike"
													onClick={() => dispatch({ kind: "fileOpened", id })}
												>
													{name ?? `(no name) ${id}`}
												</button>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</article>
				</section>
			</div>
		</div>
	);
}
