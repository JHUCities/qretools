/**
 * The open file: a question, or a scheme file. Each is its source in the editor and
 * everything derived from it beside it. Bank-level findings (a variable defined
 * twice) come from the index and are shown on the file like any other finding.
 */
import { useMemo } from "react";
import type { Evaluation } from "../../core/evaluate.js";
import { status, type Target } from "../../core/findings.js";
import { inspect } from "../../core/inspect.js";
import {
	labelsJsonSchema,
	textEntryJsonSchema,
} from "../../core/surface/schema.js";
import { bankFindings, type Index, usedBy } from "../../core/symbols.js";
import { toDiagnostics } from "../diagnostics.js";
import { fileOf, type Id, type Question, type SchemeEntry } from "../model.js";
import { isUnsaved } from "../sync.js";
import { writeBlocked } from "../update.js";
import { useApp, useEnv, useModel } from "./AppContext.js";
import { EditorPane } from "./EditorPane.js";
import { FileHeader } from "./FileHeader.js";
import {
	Codebook,
	Ddi,
	Findings,
	inlineCode,
	Respondent,
	StatusBadge,
} from "./Previews.js";

/** JSON Schemas for scheme files never change, so they are made once. */
const SCHEME_SCHEMAS = {
	labels: labelsJsonSchema(),
	text: textEntryJsonSchema(),
};

export function Editing({ id, index }: { id: Id; index: Index<Id> }) {
	const entry = useModel((m) => fileOf(m, id));
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
	const blocked = useModel(writeBlocked);
	const ddiSchema = useModel((m) => m.ddiSchema);
	const questions = useModel((m) => m.local.questions);
	const activity = useModel((m) => m.activity);
	const env = useEnv();
	const { onTarget, on } = useActions(q.id);
	const ev = evaluations.get(q, agency, env);
	const findings = useMemo(() => {
		// Another file's name, as a bank-level finding cites it.
		const label = (id: Id): string => {
			const other = questions[id];
			if (!other) return "?";
			return (
				evaluations.get(other, agency, env).draft.name ??
				other.base?.path ??
				`draft ${id}`
			);
		};
		return [...ev.findings, ...bankFindings(q.id, ev.symbols, index, label)];
	}, [ev, index, q.id, questions, evaluations, agency, env]);
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
				activity={activity[q.id]}
				blocked={blocked}
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
					<Inspector q={q} ev={ev} index={index} />
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
	const blocked = useModel(writeBlocked);
	const questions = useModel((m) => m.local.questions);
	const activity = useModel((m) => m.activity);
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
	const unsaved = isUnsaved(e);
	// Whether questions naming this file resolve: it must read as its kind.
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
				activity={activity[e.id]}
				blocked={blocked}
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
							{unsaved && (
								<p className="quiet">
									Questions here already use this version. The bank gets it when
									you save.
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
									This file does not read yet, so each of these shows a hole
									where it names <code>{e.name}</code>.
								</p>
							) : null}
							{users !== undefined && users.length > 0 && (
								<ul className="used-by">
									{users.map((id) => {
										const q = questions[id];
										const name =
											q === undefined
												? undefined
												: evaluations.get(q, agency, env).draft.name;
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

/**
 * Hazel's cursor inspector: what is at the caret. The core says what the field is and
 * what a name there names; this adds what needs the bank: who else uses the name, the
 * file to open, and the file to create when nothing has that name yet.
 */
function Inspector({
	q,
	ev,
	index,
}: {
	q: Question;
	ev: Evaluation;
	index: Index<Id>;
}) {
	const { dispatch } = useApp();
	const env = useEnv();
	const cursor = useModel((m) => m.cursor);
	const schemes = useModel((m) => m.local.schemes);
	const at = cursor?.id === q.id ? inspect(ev, env, cursor.offset) : undefined;
	if (at === undefined)
		return (
			<aside className="inspector quiet" aria-label="At the cursor">
				Put the cursor in a field to see what it is for.
			</aside>
		);
	const m = at.mention;
	const file =
		m === undefined
			? undefined
			: Object.values(schemes).find(
					(e) => e.kind === m.scheme && e.name === m.name,
				);
	const users =
		m === undefined
			? 0
			: new Set(usedBy(index, m.scheme, m.name).map((s) => s.key)).size;
	return (
		<aside className="inspector" aria-label="At the cursor">
			<p>
				<code>{at.path}</code> {at.description}
			</p>
			{m !== undefined &&
				(m.value !== undefined ? (
					<p>
						<code>{m.name}</code> is the {m.scheme}{" "}
						{"codes" in m.value
							? m.value.codes.map((c) => `${c.code} ${c.label}`).join(" · ")
							: `“${m.value.text}”`}
						, used by {users} question{users === 1 ? "" : "s"}.{" "}
						{file && (
							<button
								type="button"
								className="linklike"
								onClick={() => dispatch({ kind: "fileOpened", id: file.id })}
							>
								Open it
							</button>
						)}
					</p>
				) : (
					// The hole below says the name is unknown; this offers the fix.
					<p>
						<button
							type="button"
							className="linklike"
							onClick={() =>
								dispatch({
									kind: "schemeCreateOpened",
									scheme: m.scheme,
									name: m.name,
								})
							}
						>
							New {m.scheme} <code>{m.name}</code>
						</button>
					</p>
				))}
			{at.names !== undefined && m === undefined && (
				<p className="quiet">
					{at.names.length === 0
						? "No shared names of this kind yet."
						: `Or name a shared one: ${at.names.slice(0, 12).join(", ")}${at.names.length > 12 ? ", …" : ""}.`}
				</p>
			)}
			{at.findings.map((f) => (
				<p
					key={`${f.code}:${f.path}`}
					className={`insp-finding insp-${f.severity}`}
				>
					{inlineCode(f.message)}
				</p>
			))}
		</aside>
	);
}
