/**
 * The open file: a question, or a scheme file. Each is its source in the editor and
 * everything derived from it beside it. Bank-level findings (a variable defined
 * twice) come from the index and are shown on the file like any other finding.
 */

import { ArrowLeftIcon } from "@primer/octicons-react";
import { Button, CounterLabel, Label, Link, PageHeader } from "@primer/react";
import { ScrollableRegion } from "@primer/react/experimental";
import { memo, type ReactNode, useMemo } from "react";
import { SCHEME_NAME, SCHEME_SINGULAR, UNNAMED } from "../../core/copy.js";
import { type Evaluation, evaluate } from "../../core/evaluate.js";
import {
	type Finding,
	inDocumentOrder,
	status,
	type Target,
} from "../../core/findings.js";
import { inspect } from "../../core/inspect.js";
import {
	evaluateScheme,
	kindAt,
	type SchemeEvaluation,
} from "../../core/schemes.js";
import type { Mark } from "../../core/surface/marks.js";
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
import { alsoSaves, isUnsaved, remoteBlob, syncOf, usersIn } from "../sync.js";
import { branchOwner, hrefOf, writeBlocked } from "../update.js";
import { useApp, useEnv, useModel } from "./AppContext.js";
import { EditorPane } from "./EditorPane.js";
import { FileHeader } from "./FileHeader.js";
import { FileSkeleton, Panes } from "./FileSkeleton.js";
import {
	Codebook,
	Ddi,
	Findings,
	Respondent,
	StatusBadge,
} from "./Previews.js";
import { useSettled } from "./useSettled.js";

/**
 * How long typing must pause before the findings list catches up with the text. The
 * editor's underlines and the pane's count stay live; only the list waits, so it does
 * not reshuffle under the author mid-word.
 */
const SETTLE_MS = 400;

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
			close: () => dispatch({ kind: "listOpened" }),
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
			if (!other) return UNNAMED;
			return (
				evaluations.get(other, agency, env).draft.name ??
				other.base?.path ??
				UNNAMED
			);
		};
		return inDocumentOrder(
			[...ev.findings, ...bankFindings(q.id, ev.symbols, index, label)],
			ev.ranges,
		);
	}, [ev, index, q.id, questions, evaluations, agency, env]);
	const [listed, flush] = useSettled(findings, SETTLE_MS, q.id);
	const diagnostics = useMemo(
		() => toDiagnostics(findings, ev.ranges),
		[findings, ev.ranges],
	);
	const also = useMemo(
		() => alsoSaves(local, remote, ev.symbols.mentions, usersIn(index)),
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
								/>
							) : pane === "respondent" ? (
								<Respondent view={ev.respondent} onTarget={onTarget} />
							) : pane === "codebook" ? (
								<Codebook view={ev.codebook} onTarget={onTarget} />
							) : null
						}
					/>
					<Ddi document={ev.ddi} schema={ddiSchema} problems={problems} />
				</ScrollableRegion>
			</div>
		</>
	);
}

const SINGULAR = SCHEME_SINGULAR;

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
	const [listed, flush] = useSettled(ev.findings, SETTLE_MS, e.id);
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
						schema={
							e.kind === "universe" || e.kind === "instruction"
								? SCHEME_SCHEMAS.text
								: SCHEME_SCHEMAS.labels
						}
						label={`${SINGULAR[e.kind]} ${e.name}: source (YAML)`}
					/>
				</section>
				<ScrollableRegion key={e.id} className="right" aria-label="Previews">
					<Panes
						kind={e.kind}
						readOnly={false}
						badge={{
							findings: <StatusBadge status={status(ev.findings)} />,
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
														: evaluations.get(q, agency, env).draft.name;
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

/** What a scale, universe or instruction says, or that it can't be read yet. */
function SchemeValueView({ value }: { value: SchemeEvaluation["value"] }) {
	if (value === undefined)
		return <p className="quiet">Nothing readable yet.</p>;
	if (value.kind === "text") return <p>{value.text}</p>;
	return (
		<ul className="cb-values">
			{value.codes.map((c, i) => (
				// Codes may repeat while being edited, so the position is the key.
				// biome-ignore lint/suspicious/noArrayIndexKey: see above
				<li key={i}>
					<code className="code">{c.code}</code> {c.label}
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
function SettledFindings({
	findings,
	flush,
	onTarget,
}: {
	findings: readonly Finding[];
	flush: () => void;
	onTarget: (target: Target) => void;
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
			<Findings findings={findings} onTarget={onTarget} />
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
			: Object.values(schemes).find(
					(e) => e.kind === m.scheme && e.name === m.name,
				);
	const users =
		m === undefined
			? 0
			: new Set(usedBy(index, m.scheme, m.name).map((s) => s.key)).size;
	return (
		<InspectorBox>
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
						<code className="code">{m.name}</code> is the{" "}
						{SCHEME_NAME[m.scheme]}{" "}
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
					// What is under the cursor: a name nothing has, and the way to create it.
					<p>
						No {SCHEME_NAME[m.scheme]} is named{" "}
						<code className="code">{m.name}</code>.{" "}
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
							New {SCHEME_NAME[m.scheme]} <code className="code">{m.name}</code>
						</Button>
					</p>
				))}
			{at.names !== undefined && (m === undefined || m.value === undefined) && (
				<p className="quiet">
					{at.names.length === 0
						? "No shared names of this kind yet."
						: `Or name a shared one: ${at.names.slice(0, 12).join(", ")}${at.names.length > 12 ? ", …" : ""}.`}
				</p>
			)}
		</InspectorBox>
	);
}

/**
 * The inspector's fixed box (four lines; app.css): what does not fit scrolls, and
 * Primer's ScrollableRegion makes it focusable and a named region only then.
 */
export function InspectorBox({ children }: { children?: ReactNode }) {
	return (
		<aside className="inspector" aria-label="At the cursor">
			<ScrollableRegion className="inspector-body" aria-label="At the cursor">
				{children}
			</ScrollableRegion>
		</aside>
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
