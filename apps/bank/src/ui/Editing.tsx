/**
 * The open file: a question, a scheme file, an instrument or the workspace details.
 * Each is its source in the editor and everything derived from it beside it. Bank-level findings (a variable defined
 * twice) come from the index and are shown on the file like any other finding.
 */

import { ArrowLeftIcon } from "@primer/octicons-react";
import { Button, CounterLabel, Label, Link, PageHeader } from "@primer/react";
import { ScrollableRegion } from "@primer/react/experimental";
import {
	type Evaluation,
	evaluate,
	evaluateScheme,
	exportRefusal,
	type Finding,
	type Fix,
	fileFindings,
	type Index,
	inScope,
	isRoot,
	type Mark,
	othersOf,
	placeOf,
	type Range,
	SCHEME_NAME,
	SCHEME_SINGULAR,
	type SchemeEvaluation,
	SHAPE,
	type Shape,
	type Symbols,
	status,
	type Target,
	UNNAMED,
	usedBy,
	WORKSPACE_DETAILS,
} from "@qretools/core";
import {
	bankFileJsonSchema,
	inspect,
	labelledJsonSchema,
	labelsJsonSchema,
	outlineOf,
	textEntryJsonSchema,
	workspaceFileJsonSchema,
} from "@qretools/core/editor";
import { toDiagnostics } from "@qretools/editor";
import { bankText, formatLink } from "@qretools/shell";
import {
	Ddi,
	Download,
	Findings,
	Outline,
	type Related,
	StatusBadge,
	useSettled,
	WorkspaceNotice,
} from "@qretools/shell/ui";
import { memo, type ReactNode, useCallback, useMemo } from "react";
import {
	bankFileOf,
	type Entry,
	envOfRemote,
	fileOf,
	type Id,
	type InstrumentEntry,
	type Model,
	type Question,
	type SchemeEntry,
	schemeFileNamed,
	type WorkspaceFileEntry,
} from "../model.js";
import { alsoSaves, isUnsaved, remoteBlob, syncOf, usersIn } from "../sync.js";
import {
	bankLoading,
	branchOwner,
	hrefOf,
	instrumentAlsoSaves,
	instrumentDependencies,
	linkBranch,
	writeBlocked,
} from "../update.js";
import { useApp, useEnv, useModel } from "./AppContext.js";
import { EditorPane } from "./EditorPane.js";
import { FileHeader } from "./FileHeader.js";
import { FileSkeleton, Panes } from "./FileSkeleton.js";
import { AgencyNotice, Codebook, Respondent } from "./Previews.js";

/**
 * How long typing must pause before the findings list catches up with the text. The
 * editor's underlines and the pane's count stay live; only the list waits, so it does
 * not reshuffle under the author mid-word.
 */
const SETTLE_MS = 400;

/** JSON Schemas for scheme files never change, so they are made once. */
/** One per file shape (core `SHAPE`). */
const SCHEME_SCHEMAS: Readonly<Record<Shape, Record<string, unknown>>> = {
	labels: labelsJsonSchema(),
	text: textEntryJsonSchema(),
	labelled: labelledJsonSchema(),
	bank: bankFileJsonSchema(),
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
	switch (entry.kind) {
		case "question":
			return <QuestionEditing q={entry} index={index} />;
		case "instrument":
			return <InstrumentEditing e={entry} />;
		case "workspaceFile":
			return <WorkspaceDetailsEditing e={entry} />;
		default:
			return <SchemeEditing e={entry} index={index} />;
	}
});

/** Whether GitHub changed a file since its author started; shown only after this session's load. */
function useStale(f: Entry): boolean {
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
		// Stable, so the editor's diagnostics are rebuilt only when the findings change.
		onFix: useCallback(
			(fix: Fix) => dispatch({ kind: "fixApplied", id, fix }),
			[dispatch, id],
		),
		on: {
			save: () => dispatch({ kind: "saveRequested", id }),
			reload: () => dispatch({ kind: "reloadRequested", id }),
			remove: () => dispatch({ kind: "deleteRequested", id }),
			close: () => dispatch({ kind: "listOpened" }),
		},
	};
}

function QuestionEditing({ q, index }: { q: Question; index: Index<Id> }) {
	const { evaluations, effects } = useApp();
	const blocked = useModel(writeBlocked);
	const ddiSchema = useModel((m) => m.ddiSchema);
	const local = useModel((m) => m.local);
	const remote = useModel((m) => m.remote);
	const activity = useModel((m) => m.activity);
	const env = useEnv(q.bank);
	const { dispatch, onTarget, onFix, on } = useActions(q.id);
	const stale = useStale(q);
	const ev = evaluations.get(q, env);
	// Until the bank declares its agency, say so beside its DDI (not while it loads).
	const loading = useModel(bankLoading);
	const declare = useCallback(
		() => dispatch({ kind: "schemeCreateOpened", scheme: "bank" }),
		[dispatch],
	);
	// One element while nothing changes: the DDI pane is memoised, and a new notice per
	// render would stringify the document on every caret move.
	const notice = useMemo(
		() =>
			env.agency === undefined && !loading ? (
				<AgencyNotice declare={declare} />
			) : undefined,
		[env.agency, loading, declare],
	);
	const { findings, related } = useBankFindings(
		q.id,
		ev.findings,
		ev.symbols,
		ev.ranges,
		index,
	);
	const [listed, flush] = useSettled(findings, SETTLE_MS, q.id);
	const diagnostics = useMemo(
		() => toDiagnostics(findings, ev.ranges, onFix),
		[findings, ev.ranges, onFix],
	);
	const also = useMemo(
		() => alsoSaves(local, remote, ev.symbols.mentions, usersIn(index), q.bank),
		[local, remote, ev.symbols.mentions, index, q.bank],
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
		<>
			<FileHeader
				q={q}
				name={ev.draft.name}
				unsaved={isUnsaved(q)}
				activity={activity[q.id]}
				blocked={blocked}
				also={also}
				stale={stale}
				on={{
					...on,
					save: () => {
						flush();
						on.save();
					},
					...(q.base !== undefined && {
						move: () => dispatch({ kind: "moveRequested", id: q.id }),
					}),
				}}
			/>
			<div className="split">
				{/* Leaving the editor (by blur, which bubbles in React) is a pause. */}
				<section className="left" aria-label="Question source" onBlur={flush}>
					<EditorPane
						id={q.id}
						text={q.source}
						diagnostics={diagnostics}
						marks={ev.marks}
						schema={evaluations.schema(env)}
						label={`Question ${ev.draft.name ?? UNNAMED}: source (YAML)`}
					/>
					<Inspector q={q} ev={ev} index={index} />
				</section>
				{/* Keyed by file: each opens scrolled to the top (React: reset state with a key). */}
				<ScrollableRegion key={q.id} className="right" aria-label="Previews">
					<Panes
						kind="question"
						readOnly={false}
						badge={{ findings: <StatusBadge status={status(findings)} /> }}
						body={(pane) =>
							pane === "findings" ? (
								<SettledFindings
									findings={listed}
									flush={flush}
									onTarget={onTarget}
									related={related}
									onFix={onFix}
								/>
							) : pane === "respondent" ? (
								<Respondent view={ev.respondent} onTarget={onTarget} />
							) : pane === "codebook" ? (
								<Codebook view={ev.codebook} onTarget={onTarget} />
							) : null
						}
					/>
					<Ddi
						document={ev.ddi}
						schema={ddiSchema}
						problems={problems}
						{...(notice !== undefined && { notice })}
					/>
				</ScrollableRegion>
			</div>
		</>
	);
}

/** The slices an instrument is read from: a caret move changes none of them. */
function useSlices() {
	const local = useModel((m) => m.local);
	const remote = useModel((m) => m.remote);
	const banks = useModel((m) => m.banks);
	const remoteBanks = useModel((m) => m.remoteBanks);
	return useMemo(
		() => ({ local, remote, banks, remoteBanks }),
		[local, remote, banks, remoteBanks],
	);
}

/**
 * An instrument: read live against the banks it uses, its findings and outline settling
 * as a question's findings do, and its DDI with the download, which goes where the DDI
 * is (its refusal comes and goes as the author types; the header must not move).
 */
function InstrumentEditing({ e }: { e: InstrumentEntry }) {
	const { evaluations, effects } = useApp();
	const blocked = useModel(writeBlocked);
	const ddiSchema = useModel((m) => m.ddiSchema);
	const activity = useModel((m) => m.activity);
	const slices = useSlices();
	const { onTarget, onFix, on } = useActions(e.id);
	const stale = useStale(e);
	const read = evaluations.instrument(slices, e);
	const { instrument } = read;
	// A name is green exactly where it can be followed: where its bank resolves it.
	const marks = useMemo(
		(): readonly Mark[] =>
			instrument.refs.map((r) => ({ kind: "ref", range: r.range })),
		[instrument.refs],
	);
	const own = evaluations.workspaceFile(slices);
	const { findings, ranges, draft, ddi } = instrument;
	const [listed, flushFindings] = useSettled(findings, SETTLE_MS, e.id);
	const outline = useMemo(() => outlineOf(draft), [draft]);
	const [outlined, flushOutline] = useSettled(outline, SETTLE_MS, e.id);
	const flush = () => {
		flushFindings();
		flushOutline();
	};
	const diagnostics = useMemo(
		() => toDiagnostics(findings, ranges, onFix),
		[findings, ranges, onFix],
	);
	const also = useMemo(
		() =>
			instrumentAlsoSaves(
				instrumentDependencies(
					slices,
					read,
					(q) =>
						evaluations.get(q, evaluations.env(slices, q.bank)).symbols
							.mentions,
				),
				(q) =>
					evaluations.get(q, evaluations.env(slices, q.bank)).draft.name ??
					UNNAMED,
			),
		[slices, read, evaluations],
	);
	const problems = useMemo(
		() =>
			ddiSchema.kind === "failed"
				? [ddiSchema.finding]
				: (effects.validate(ddi) ?? []),
		[ddi, ddiSchema, effects],
	);
	const refusal = exportRefusal(instrument, problems);
	const notice = useMemo(
		() => (
			<>
				<Download name={e.name} ddi={ddi} refusal={refusal} />
				<WorkspaceNotice own={own} />
			</>
		),
		[e.name, ddi, refusal, own],
	);
	return (
		<>
			<FileHeader
				q={e}
				name={e.name}
				kind="instrument"
				unsaved={isUnsaved(e)}
				activity={activity[e.id]}
				blocked={blocked}
				also={also}
				stale={stale}
				on={{
					...on,
					save: () => {
						flush();
						on.save();
					},
				}}
			/>
			<div className="split">
				<section className="left" aria-label="Instrument source" onBlur={flush}>
					<EditorPane
						id={e.id}
						text={e.source}
						diagnostics={diagnostics}
						marks={marks}
						instrument
						label={`Instrument ${e.name}: source (YAML)`}
					/>
				</section>
				<ScrollableRegion key={e.id} className="right" aria-label="Previews">
					<Panes
						kind="instrument"
						readOnly={false}
						badge={{ findings: <StatusBadge status={status(findings)} /> }}
						body={(pane) =>
							pane === "findings" ? (
								<SettledFindings
									findings={listed}
									flush={flush}
									onTarget={onTarget}
									onFix={onFix}
								/>
							) : pane === "outline" ? (
								<div onPointerEnter={flush}>
									{outlined.length === 0 ? (
										<p className="quiet">The flow has no steps yet.</p>
									) : (
										<Outline items={outlined} onTarget={onTarget} />
									)}
								</div>
							) : null
						}
					/>
					<Ddi
						document={ddi}
						schema={ddiSchema}
						problems={problems}
						notice={notice}
					/>
				</ScrollableRegion>
			</div>
		</>
	);
}

const WORKSPACE_SCHEMA = workspaceFileJsonSchema();

/** The workspace details: the agency its instruments are published under. */
function WorkspaceDetailsEditing({ e }: { e: WorkspaceFileEntry }) {
	const { evaluations } = useApp();
	const blocked = useModel(writeBlocked);
	const activity = useModel((m) => m.activity);
	const slices = useSlices();
	const { onTarget, onFix, on } = useActions(e.id);
	const stale = useStale(e);
	const own = evaluations.workspaceFile(slices);
	const findings = own?.findings ?? NO_FINDINGS;
	const ranges = own?.ranges ?? NO_RANGES;
	const [listed, flush] = useSettled(findings, SETTLE_MS, e.id);
	const diagnostics = useMemo(
		() => toDiagnostics(findings, ranges, onFix),
		[findings, ranges, onFix],
	);
	return (
		<>
			<FileHeader
				q={e}
				name={WORKSPACE_DETAILS}
				unsaved={isUnsaved(e)}
				activity={activity[e.id]}
				blocked={blocked}
				stale={stale}
				on={{
					...on,
					save: () => {
						flush();
						on.save();
					},
				}}
			/>
			<div className="split">
				<section
					className="left"
					aria-label="Workspace details source"
					onBlur={flush}
				>
					<EditorPane
						id={e.id}
						text={e.source}
						diagnostics={diagnostics}
						marks={NO_MARKS}
						schema={WORKSPACE_SCHEMA}
						label="Workspace details: source (YAML)"
					/>
				</section>
				<ScrollableRegion key={e.id} className="right" aria-label="Previews">
					<Panes
						kind="workspaceFile"
						readOnly={false}
						badge={{ findings: <StatusBadge status={status(findings)} /> }}
						body={(pane) =>
							pane === "findings" ? (
								<SettledFindings
									findings={listed}
									flush={flush}
									onTarget={onTarget}
									onFix={onFix}
								/>
							) : null
						}
					/>
				</ScrollableRegion>
			</div>
		</>
	);
}

const NO_FINDINGS: readonly Finding[] = [];
const NO_RANGES: Readonly<Record<string, Range>> = {};

const SINGULAR = SCHEME_SINGULAR;

function SchemeEditing({ e, index }: { e: SchemeEntry; index: Index<Id> }) {
	const { evaluations } = useApp();
	const blocked = useModel(writeBlocked);
	const questions = useModel((m) => m.local.questions);
	const activity = useModel((m) => m.activity);
	const env = useEnv(e.bank);
	const { dispatch, onTarget, onFix, on } = useActions(e.id);
	const eStale = useStale(e);
	const ev = evaluations.scheme(e, env);
	const { findings, related } = useBankFindings(
		e.id,
		ev.findings,
		ev.symbols,
		ev.ranges,
		index,
	);
	const diagnostics = useMemo(
		() => toDiagnostics(findings, ev.ranges, onFix),
		[findings, ev.ranges, onFix],
	);
	const [listed, flush] = useSettled(findings, SETTLE_MS, e.id);
	const users = isRoot(e.kind)
		? undefined
		: [...new Set(usedBy(index, e.kind, e.name).map((s) => s.key))];
	const unsaved = isUnsaved(e);
	// Whether the file is in effect: it must read as its kind.
	const inEffect =
		e.kind === "missing"
			? env.missing.length > 0
			: e.kind === "bank"
				? env.agency !== undefined
				: inScope(env, e.kind)[e.name] !== undefined;
	return (
		<>
			<FileHeader
				q={e}
				name={e.name}
				kind={SINGULAR[e.kind]}
				unsaved={isUnsaved(e)}
				activity={activity[e.id]}
				blocked={blocked}
				stale={eStale}
				on={{
					...on,
					save: () => {
						flush();
						on.save();
					},
					...(!isRoot(e.kind) &&
						e.base === undefined && {
							rename: () => dispatch({ kind: "schemeRenameOpened", id: e.id }),
						}),
				}}
			/>
			<div className="split">
				<section
					className="left"
					aria-label={`${SINGULAR[e.kind]} source`}
					onBlur={flush}
				>
					<EditorPane
						id={e.id}
						text={e.source}
						diagnostics={diagnostics}
						marks={ev.marks}
						schema={SCHEME_SCHEMAS[SHAPE[e.kind]]}
						label={`${SINGULAR[e.kind]} ${e.name}: source (YAML)`}
					/>
				</section>
				<ScrollableRegion key={e.id} className="right" aria-label="Previews">
					<Panes
						kind={e.kind}
						readOnly={false}
						badge={{
							findings: <StatusBadge status={status(findings)} />,
							usedBy: users !== undefined && (
								<CounterLabel>{users.length}</CounterLabel>
							),
						}}
						body={(pane) =>
							pane === "findings" ? (
								<SettledFindings
									findings={listed}
									flush={flush}
									onTarget={onTarget}
									related={related}
									onFix={onFix}
								/>
							) : pane === "value" ? (
								<>
									<SchemeValueView value={ev.value} />
									{unsaved && (
										<p className="quiet">
											Questions in this browser already use this version. The
											bank gets it when you save to your branch and your pull
											request is merged.
										</p>
									)}
								</>
							) : pane === "usedBy" ? (
								<>
									{users === undefined ? (
										<p className="quiet">
											Every variable in the bank uses the missing values.
										</p>
									) : users.length === 0 ? (
										<p className="quiet">No question names it.</p>
									) : !inEffect ? (
										<p className="fg-attention">
											This can't be read yet, so each of these shows a field to
											fill in where it names{" "}
											<code className="code">{e.name}</code>.
										</p>
									) : null}
									{users !== undefined && users.length > 0 && (
										<ul className="used-by">
											{users.map((id) => {
												const q = questions[id];
												const name =
													q === undefined
														? undefined
														: evaluations.get(q, env).draft.name;
												return (
													<li key={id}>
														<FileLink
															id={id}
															onOpen={() =>
																dispatch({ kind: "fileOpened", id })
															}
														>
															{name ?? UNNAMED}
														</FileLink>
													</li>
												);
											})}
										</ul>
									)}
								</>
							) : null
						}
					/>
				</ScrollableRegion>
			</div>
		</>
	);
}

/** What a shared file says, or that it can't be read yet. */
function SchemeValueView({ value }: { value: SchemeEvaluation["value"] }) {
	if (value === undefined)
		return <p className="quiet">Nothing readable yet.</p>;
	if (value.kind === "text") return <p>{value.text}</p>;
	if (value.kind === "bank")
		return (
			<p>
				Items are published under the DDI agency{" "}
				<code className="code">{value.agency}</code>.
			</p>
		);
	if (value.kind === "labelled")
		return (
			<>
				<p>
					<b>{value.entry.label}</b>
				</p>
				{value.entry.definition !== undefined && (
					<p>{value.entry.definition}</p>
				)}
			</>
		);
	return (
		<ul className="cb-values">
			{value.codes.map((c, i) => (
				// Codes may repeat while being edited, so the position is the key.
				// biome-ignore lint/suspicious/noArrayIndexKey: see above
				<li key={i}>
					<code className="code code-response">{c.code}</code> {c.label}
				</li>
			))}
		</ul>
	);
}

/**
 * The findings list as it stood at the last pause (`useSettled`). Reaching for it
 * catches it up before any press: the pointer entering the list, or keyboard focus
 * arriving. Never on the press itself: an item moving between pointer down and click
 * would send the click to another finding. (A slightly stale click is harmless: its
 * target is a path, resolved against the text as it is now.)
 * Nothing here is a live region: the list changes silently, the count beside it says
 * how many there are.
 */
/**
 * A file's own findings with the bank's added: what another file repeats or also
 * defines, each linked to that file. Names are labels only; a draft has no link.
 */
function useBankFindings(
	id: Id,
	own: readonly Finding[],
	symbols: Symbols,
	ranges: Readonly<Record<string, Range>>,
	index: Index<Id>,
): {
	readonly findings: readonly Finding[];
	readonly related: (f: Finding) => Related | undefined;
} {
	const { evaluations } = useApp();
	const local = useModel((m) => m.local);
	const owner = useModel((m) => m.settings.owner);
	const repo = useModel((m) => m.settings.repo);
	const folder = useModel((m) => m.settings.path);
	const branch = useModel(linkBranch);
	// The files a bank finding cites are in this file's bank: the index is that bank's.
	const bank = useModel((m) => bankFileOf(m, id)?.bank ?? "");
	const env = useEnv(bank);
	return useMemo(() => {
		// Another file's name, as a bank-level finding cites it.
		const label = (other: Id): string => {
			const q = local.questions[other];
			if (q)
				return evaluations.get(q, env).draft.name ?? q.base?.path ?? UNNAMED;
			return local.schemes[other]?.name ?? UNNAMED;
		};

		// From the finding itself: the list shows settled, older objects while typing.
		const related = (f: Finding): Related | undefined => {
			const other = othersOf<Id>(f)[0];
			if (other === undefined || branch === undefined) return undefined;
			const path = (local.questions[other] ?? local.schemes[other])?.base?.path;
			return path === undefined
				? undefined
				: {
						href: formatLink({
							repo: bankText({ owner, repo, path: folder }),
							branch,
							file: path,
						}),
						label: `Open ${label(other)}`,
					};
		};
		return {
			findings: fileFindings(
				id,
				{ findings: own, symbols, ranges },
				index,
				label,
			),
			related,
		};
	}, [
		id,
		own,
		symbols,
		ranges,
		index,
		local,
		evaluations,
		env,
		owner,
		repo,
		folder,
		branch,
	]);
}

function SettledFindings({
	findings,
	flush,
	onTarget,
	related,
	onFix,
}: {
	findings: readonly Finding[];
	flush: () => void;
	onTarget: (target: Target) => void;
	related?: (f: Finding) => Related | undefined;
	onFix: (fix: Fix) => void;
}) {
	return (
		<div
			onPointerEnter={flush}
			onFocusCapture={(e) => {
				// Keyboard focus only: a pointer press also focuses, mid-click.
				if (e.target instanceof Element && e.target.matches(":focus-visible"))
					flush();
			}}
		>
			<Findings
				findings={findings}
				onTarget={onTarget}
				{...(related !== undefined && { related })}
				onFix={onFix}
			/>
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
	const env = useEnv(q.bank);
	const cursor = useModel((m) => m.cursor);
	const schemes = useModel((m) => m.local.schemes);
	const at =
		cursor?.id === q.id ? inspect(ev, env, q.source, cursor.offset) : undefined;
	if (at === undefined)
		return (
			<InspectorBox>
				<p className="quiet">
					Put the cursor in a field to see what it is for.
				</p>
			</InspectorBox>
		);
	const m = at.mention;
	const file =
		m === undefined
			? undefined
			: schemeFileNamed(schemes, m.scheme, m.name, q.bank);
	const users =
		m === undefined
			? 0
			: new Set(usedBy(index, m.scheme, m.name).map((s) => s.key)).size;
	const scheme = m?.scheme ?? at.scheme;
	const names =
		at.names === undefined
			? undefined
			: at.names.length === 0
				? "None shared yet."
				: `${at.names.slice(0, 12).join(", ")}${at.names.length > 12 ? ", …" : ""}.`;
	return (
		<InspectorBox>
			{/*
			 * Two rows: the field, what it is for in any question (muted: reference; between
			 * fields, the question's own description); and the value, when it names a shared
			 * entry (what it is, who uses it) or could. With nothing to say the Value row is
			 * invisible but kept (`visibility: hidden`, unheard too): "Value" is the wider
			 * label, so the column, and the field's text, never shift sideways.
			 */}
			<dl className="inspect">
				<dt>Field</dt>
				<dd>
					{at.key !== undefined && <code className="code">{at.path}</code>}{" "}
					<span className="quiet">{at.description}</span>
				</dd>
				{m !== undefined && (
					<>
						<dt>Value</dt>
						{m.value !== undefined ? (
							// The name, opening its file; what it is and who uses it. Its content is
							// the previews' (the respondent's pane shows a scale's options).
							<dd>
								{file ? (
									<FileLink
										id={file.id}
										onOpen={() => dispatch({ kind: "fileOpened", id: file.id })}
									>
										<code className="code code-ref">{m.name}</code>
									</FileLink>
								) : (
									<code className="code code-ref">{m.name}</code>
								)}{" "}
								<span className="quiet">
									{SCHEME_NAME[m.scheme]} · used by {users} question
									{users === 1 ? "" : "s"}
								</span>
							</dd>
						) : (
							// A name nothing has, and the way to create it.
							<dd>
								<div>
									No {SCHEME_NAME[m.scheme]} is named{" "}
									<code className="code">{m.name}</code>.{" "}
									<Button
										variant="link"
										onClick={() =>
											dispatch({
												kind: "schemeCreateOpened",
												scheme: m.scheme,
												name: m.name,
												// Exactly where it is named: the path at the caret.
												use: { id: q.id, path: at.path },
											})
										}
									>
										New {SCHEME_NAME[m.scheme]}{" "}
										<code className="code">{m.name}</code>
									</Button>
								</div>
								{names !== undefined && (
									<div className="quiet">Or name a shared one: {names}</div>
								)}
							</dd>
						)}
					</>
				)}
				{/* Nothing named yet: where a shared one can be, the names in scope. */}
				{m === undefined &&
					(scheme !== undefined && names !== undefined ? (
						<>
							<dt>Value</dt>
							<dd className="quiet">Name a shared one: {names}</dd>
						</>
					) : (
						<>
							<dt className="inspect-unset">Value</dt>
							<dd className="inspect-unset" />
						</>
					))}
			</dl>
		</InspectorBox>
	);
}

/**
 * The inspector's fixed box (four lines; the shell's app.css): what does not fit scrolls, and
 * Primer's ScrollableRegion makes it focusable and a named region only then. A plain
 * div around it: one name, not two, and no complementary landmark nested inside the
 * source's region.
 */
export function InspectorBox({ children }: { children?: ReactNode }) {
	return (
		<div className="inspector">
			<ScrollableRegion className="inspector-body" aria-label="At the cursor">
				{children}
			</ScrollableRegion>
		</div>
	);
}

/** One empty list, so an editor with nothing to mark is not re-synced for a new one. */
const NO_MARKS: readonly Mark[] = [];

/** Whose version a branch holds, as a person would say it. */
const whose = (branch: string): string => {
	const owner = branchOwner(branch);
	return owner !== undefined ? `${owner}'s version` : `the ${branch} version`;
};

/**
 * Another author's version of a file, from a link: read only (owner, 2026-09-25).
 * Evaluated against their branch's shared files (`envOfRemote`), so names resolve,
 * and are coloured, as they do for them.
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
	const own = useModel((m) =>
		[
			...Object.values(m.local.questions),
			...Object.values(m.local.schemes),
		].find((f) => f.base?.path === screen.path),
	);
	const file = screen.file;
	// One value per path, so the evaluations below keep theirs between renders.
	const banks = useModel((m) => m.banks);
	const at = useMemo(
		() => placeOf(screen.path, banks)?.at,
		[screen.path, banks],
	);
	const kind = at?.kind;
	const ev = useMemo(
		() =>
			file === undefined || kind !== "question"
				? undefined
				: evaluate(file.text, env),
		[file, kind, env],
	);
	const scheme = useMemo(
		() =>
			file === undefined || at === undefined || at.kind === "question"
				? undefined
				: evaluateScheme(at.kind, file.text, env, at.name),
		[file, at, env],
	);
	const findings = ev?.findings ?? scheme?.findings ?? [];
	const ranges = ev?.ranges ?? scheme?.ranges ?? {};
	const marks = ev?.marks ?? scheme?.marks ?? NO_MARKS;
	const diagnostics = useMemo(
		() => toDiagnostics(findings, ranges),
		[findings, ranges],
	);
	return (
		<>
			<div className="qhead">
				<PageHeader>
					<PageHeader.ContextArea>
						<Button
							className="back"
							variant="invisible"
							size="small"
							leadingVisual={ArrowLeftIcon}
							onClick={() => dispatch({ kind: "listOpened" })}
						>
							Back to the bank
						</Button>
					</PageHeader.ContextArea>
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
				// The top bar's status says what is loading; this is its shape.
				<FileSkeleton kind={kind ?? "question"} readOnly />
			) : (
				<div className="split">
					<section className="left" aria-label="Their source">
						<EditorPane
							id={-1}
							text={file.text}
							diagnostics={diagnostics}
							marks={marks}
							schema={
								kind === undefined || kind === "question"
									? evaluations.schema(env)
									: SCHEME_SCHEMAS[SHAPE[kind]]
							}
							readOnly
							label={`${whose(screen.branch)} of ${screen.path} (YAML, read only)`}
						/>
					</section>
					<ScrollableRegion
						key={screen.path}
						className="right"
						aria-label="Previews"
					>
						<Panes
							kind={kind ?? "question"}
							readOnly
							badge={{ findings: <StatusBadge status={status(findings)} /> }}
							body={(pane) =>
								pane === "findings" ? (
									<Findings findings={findings} />
								) : pane === "respondent" && ev ? (
									<Respondent view={ev.respondent} />
								) : pane === "codebook" && ev ? (
									<Codebook view={ev.codebook} />
								) : pane === "value" ? (
									<SchemeValueView value={scheme?.value} />
								) : null
							}
						/>
					</ScrollableRegion>
				</div>
			)}
		</>
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
