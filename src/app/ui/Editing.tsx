/**
 * The open file: a question, or a scheme file. Each is its source in the editor and
 * everything derived from it beside it. Bank-level findings (a variable defined
 * twice) come from the index and are shown on the file like any other finding.
 */
import { Button, Label, Link, PageHeader } from "@primer/react";
import { ScrollableRegion } from "@primer/react/experimental";
import { memo, type ReactNode, useMemo } from "react";
import { type Evaluation, evaluate } from "../../core/evaluate.js";
import { status, type Target } from "../../core/findings.js";
import { inspect } from "../../core/inspect.js";
import { evaluateScheme, kindAt } from "../../core/schemes.js";
import {
	labelsJsonSchema,
	textEntryJsonSchema,
} from "../../core/surface/schema.js";
import { bankFindings, type Index, usedBy } from "../../core/symbols.js";
import { toDiagnostics } from "../diagnostics.js";
import {
	envOfRemote,
	fileOf,
	type Id,
	type Model,
	type Question,
	type SchemeEntry,
} from "../model.js";
import { alsoSaves, isUnsaved, remoteBlob, syncOf } from "../sync.js";
import { hrefOf, writeBlocked } from "../update.js";
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

/**
 * Memoised on `id` and `index`, neither of which a caret move changes: moving the caret
 * re-renders only the inspector, which is the one component that reads the cursor.
 */
export const Editing = memo(function Editing({
	id,
	index,
}: {
	id: Id;
	index: Index<Id>;
}) {
	const entry = useModel((m) => fileOf(m, id));
	if (!entry) return null;
	return entry.kind === "question" ? (
		<QuestionEditing q={entry} index={index} />
	) : (
		<SchemeEditing e={entry} index={index} />
	);
});

/** Whether GitHub changed a file since its author started; shown only after this session's load. */
function useStale(f: Question | SchemeEntry): boolean {
	const remote = useModel((m) => m.remote);
	const loaded = useModel((m) => m.loading.kind === "loaded");
	if (!loaded) return false;
	const sync = syncOf(f, remoteBlob(remote, f));
	return sync === "conflict" || sync === "deletedOnGitHub";
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
	const local = useModel((m) => m.local);
	const remote = useModel((m) => m.remote);
	const activity = useModel((m) => m.activity);
	const env = useEnv();
	const { dispatch, onTarget, on } = useActions(q.id);
	const stale = useStale(q);
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
	const also = useMemo(
		() =>
			alsoSaves(local, remote, ev.symbols.mentions, (e) =>
				e.kind === "missing"
					? []
					: usedBy(index, e.kind, e.name).map((s) => s.key),
			),
		[local, remote, ev.symbols.mentions, index],
	);
	// Schema validation runs over the whole document: only when the document changes,
	// never on a caret move.
	const problems = useMemo(
		() =>
			ddiSchema.kind === "failed"
				? [ddiSchema.finding]
				: (effects.validate(ev.ddi) ?? []),
		[ev.ddi, ddiSchema, effects],
	);
	return (
		<div className="editing">
			<FileHeader
				q={q}
				name={ev.draft.name}
				unsaved={isUnsaved(q)}
				activity={activity[q.id]}
				blocked={blocked}
				also={also}
				stale={stale}
				on={
					q.base === undefined
						? on
						: {
								...on,
								move: () => dispatch({ kind: "moveRequested", id: q.id }),
							}
				}
			/>
			<div className="split">
				<section className="left" aria-label="Question source">
					<EditorPane
						id={q.id}
						text={q.source}
						diagnostics={diagnostics}
						schema={evaluations.schema(env)}
						label={`Question ${ev.draft.name ?? "(no name yet)"}: source (YAML)`}
					/>
					<Inspector q={q} ev={ev} index={index} />
				</section>
				<ScrollableRegion className="right" aria-label="Previews">
					<article className="pane">
						<h3>
							Findings <StatusBadge status={status(findings)} />
						</h3>
						<div className="pane-body">
							<Findings findings={findings} onTarget={onTarget} />
						</div>
					</article>
					<article className="pane">
						<h3>As the respondent sees it</h3>
						<div className="pane-body">
							<Respondent view={ev.respondent} onTarget={onTarget} />
						</div>
					</article>
					<article className="pane">
						<h3>Codebook entry</h3>
						<div className="pane-body">
							<Codebook view={ev.codebook} onTarget={onTarget} />
						</div>
					</article>
					<Ddi document={ev.ddi} schema={ddiSchema} problems={problems} />
				</ScrollableRegion>
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
	const eStale = useStale(e);
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
				stale={eStale}
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
						label={`${SINGULAR[e.kind]} ${e.name}: source (YAML)`}
					/>
				</section>
				<ScrollableRegion className="right" aria-label="Previews">
					<article className="pane">
						<h3>
							Findings <StatusBadge status={status(ev.findings)} />
						</h3>
						<div className="pane-body">
							<Findings findings={ev.findings} onTarget={onTarget} />
						</div>
					</article>
					<article className="pane">
						<h3>{SINGULAR[e.kind]}</h3>
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
											<code className="code">{c.code}</code> {c.label}
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
						<h3>
							{users === undefined ? "Used by" : `Used by ${users.length}`}
						</h3>
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
									where it names <code className="code">{e.name}</code>.
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
												<FileLink
													id={id}
													onOpen={() => dispatch({ kind: "fileOpened", id })}
												>
													{name ?? `(no name) ${id}`}
												</FileLink>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</article>
				</ScrollableRegion>
			</div>
		</div>
	);
}

/** A finding's severity as one of the colour utilities: the text says the rest. */
const SEVERITY_COLOUR: Readonly<Record<string, string>> = {
	hole: "fg-attention",
	warning: "fg-attention",
	error: "fg-danger",
	info: "fg-accent",
};

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
				{at.key === undefined ? (
					<b>Question. </b>
				) : (
					<code className="code">{at.path}</code>
				)}{" "}
				{at.description}
			</p>
			{m !== undefined &&
				(m.value !== undefined ? (
					<p>
						<code className="code">{m.name}</code> is the {m.scheme}{" "}
						{"codes" in m.value
							? m.value.codes.map((c) => `${c.code} ${c.label}`).join(" · ")
							: `“${m.value.text}”`}
						, used by {users} question{users === 1 ? "" : "s"}.{" "}
						{file && (
							<FileLink
								id={file.id}
								onOpen={() => dispatch({ kind: "fileOpened", id: file.id })}
							>
								Open {m.name}
							</FileLink>
						)}
					</p>
				) : (
					// The hole below says the name is unknown; this offers the fix.
					<p>
						<Button
							variant="link"
							onClick={() =>
								dispatch({
									kind: "schemeCreateOpened",
									scheme: m.scheme,
									name: m.name,
								})
							}
						>
							New {m.scheme} <code className="code">{m.name}</code>
						</Button>
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
				<p key={`${f.code}:${f.path}`} className={SEVERITY_COLOUR[f.severity]}>
					{inlineCode(f.message)}
				</p>
			))}
		</aside>
	);
}

/** Whose version a branch holds, as a person would say it. */
const whose = (branch: string): string =>
	branch.startsWith("qretools/")
		? `${branch.slice("qretools/".length)}'s version`
		: `the ${branch} version`;

/**
 * Another author's version of a file, from a link: read only (owner, 2026-09-25).
 * Evaluated against your environment, so it reads here as it would in your bank.
 */
export function ForeignView({
	screen,
}: {
	screen: Extract<Model["screen"], { kind: "foreign" }>;
}) {
	const { dispatch, evaluations } = useApp();
	// Their question reads against their branch's shared files, never your own edits.
	const env = useMemo(
		() => envOfRemote(screen.schemes ?? {}),
		[screen.schemes],
	);
	const agency = useModel((m) => m.agency);
	const own = useModel((m) =>
		[
			...Object.values(m.local.questions),
			...Object.values(m.local.schemes),
		].find((f) => f.base?.path === screen.path),
	);
	const file = screen.file;
	const kind = kindAt(screen.path)?.kind;
	const ev = useMemo(
		() =>
			file === undefined || kind !== "question"
				? undefined
				: evaluate(file.text, agency, env),
		[file, kind, agency, env],
	);
	const scheme = useMemo(
		() =>
			file === undefined || kind === undefined || kind === "question"
				? undefined
				: evaluateScheme(kind, file.text, env),
		[file, kind, env],
	);
	const findings = ev?.findings ?? scheme?.findings ?? [];
	const ranges = ev?.ranges ?? scheme?.ranges ?? {};
	const diagnostics = useMemo(
		() => toDiagnostics(findings, ranges),
		[findings, ranges],
	);
	return (
		<div className="editing">
			<div className="qhead">
				<PageHeader>
					<PageHeader.TitleArea variant="subtitle">
						<PageHeader.Title as="h2">
							<span className="quiet">{whose(screen.branch)} of </span>
							{screen.path}
						</PageHeader.Title>
						<PageHeader.TrailingVisual>
							<Label>read only</Label>
						</PageHeader.TrailingVisual>
					</PageHeader.TitleArea>
					{own !== undefined && (
						<PageHeader.Actions>
							<Button
								size="small"
								onClick={() => dispatch({ kind: "fileOpened", id: own.id })}
							>
								Open your copy
							</Button>
						</PageHeader.Actions>
					)}
				</PageHeader>
			</div>
			{file === undefined ? (
				<p className="quiet blank">
					Loading {screen.path} from {screen.branch}…
				</p>
			) : (
				<div className="split">
					<section className="left" aria-label="Their source">
						<EditorPane
							id={-1}
							text={file.text}
							diagnostics={diagnostics}
							schema={
								kind === "question"
									? evaluations.schema(env)
									: kind === "universe" || kind === "instruction"
										? SCHEME_SCHEMAS.text
										: SCHEME_SCHEMAS.labels
							}
							readOnly
							label={`${whose(screen.branch)} of ${screen.path} (YAML, read only)`}
						/>
					</section>
					<ScrollableRegion className="right" aria-label="Previews">
						<article className="pane">
							<h3>
								Findings <StatusBadge status={status(findings)} />
							</h3>
							<div className="pane-body">
								<Findings findings={findings} />
							</div>
						</article>
						{ev && (
							<>
								<article className="pane">
									<h3>As the respondent sees it</h3>
									<div className="pane-body">
										<Respondent view={ev.respondent} />
									</div>
								</article>
								<article className="pane">
									<h3>Codebook entry</h3>
									<div className="pane-body">
										<Codebook view={ev.codebook} />
									</div>
								</article>
							</>
						)}
					</ScrollableRegion>
				</div>
			)}
		</div>
	);
}

/**
 * Opening a file is navigation, so it is a link (`<a href="#…">`, which the browser's
 * hashchange opens, and which can open in a new tab). A draft has no address on GitHub
 * yet, so it opens with a button instead.
 */
function FileLink({
	id,
	onOpen,
	children,
}: {
	id: Id;
	onOpen: () => void;
	children: ReactNode;
}) {
	const href = useModel((m) => {
		const f = fileOf(m, id);
		return f === undefined ? undefined : hrefOf(m, f);
	});
	return href !== undefined ? (
		<Link href={href}>{children}</Link>
	) : (
		<Button variant="link" onClick={onOpen}>
			{children}
		</Button>
	);
}
