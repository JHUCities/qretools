/** The previews, drawn from the core's render models. They decide nothing. */

import { Link } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import {
	blocksOf,
	type CodebookFinding,
	type Codebook as CodebookModel,
	type Described,
	type Entry,
	formatWords,
	type Ref,
	type Row,
	type Span,
	type Text,
} from "@qretools/codebook";
import {
	type Hole,
	type Input,
	itemKeyOf,
	type Resolved,
	type RespondentView,
	type Result,
	type Slot,
	sharedOf,
	type TextSlot,
	UNDECLARED_AGENCY,
	UNNAMED,
} from "@qretools/core";
import { ExternalLink, type OnTarget } from "@qretools/shell/ui";
import { Fragment, type ReactNode, useId } from "react";

/** A hole in a preview: a button to its place in the source, or plain text where there is no source to go to. */
function HoleButton({ hole, onTarget }: { hole: Hole; onTarget: OnTarget }) {
	if (onTarget === undefined)
		return <span className="hole">{hole.prompt}</span>;
	return (
		<button
			type="button"
			className="hole"
			onClick={() => onTarget({ path: hole.path, severity: "hole" })}
		>
			{hole.prompt}
		</button>
	);
}

const slot = (s: Slot, onTarget: OnTarget): ReactNode =>
	s.kind === "filled" ? s.text : <HoleButton hole={s} onTarget={onTarget} />;

/**
 * Question text, each fill shown as the gap it is, `[rent]`, as a codebook writes it:
 * what goes there is the instrument's to say.
 */
const textSlot = (s: TextSlot, onTarget: OnTarget): ReactNode =>
	s.kind === "filled" && s.pieces !== undefined
		? s.pieces.map((p, i) =>
				p.kind === "words" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: pieces are positional
					<Fragment key={i}>{p.text}</Fragment>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: pieces are positional
					<span key={i} className="fill-slot">
						[{p.name}]
					</span>
				),
			)
		: slot(s, onTarget);

export function Respondent({
	view,
	onTarget,
}: {
	view: RespondentView;
	onTarget?: OnTarget;
}) {
	return (
		<fieldset className="respondent">
			<legend>{textSlot(view.text, onTarget)}</legend>
			{view.instruction !== undefined && (
				<p className="instruction">
					<ResolvedText value={view.instruction} />
				</p>
			)}
			<RespondentInput input={view.input} onTarget={onTarget} />
		</fieldset>
	);
}

function RespondentInput({
	input,
	onTarget,
}: {
	input: Input;
	onTarget?: OnTarget;
}) {
	const group = useId();
	switch (input.kind) {
		case "hole":
			return <HoleButton hole={input} onTarget={onTarget} />;
		case "choice":
			// Inputs sit inside their labels; the group's name is this preview's own
			// (author-spelled codes make poor ids, and `name` may still be a hole).
			return (
				<div className="options">
					{input.options.map((o) => (
						<label key={o.code}>
							<input
								type={input.select === "one" ? "radio" : "checkbox"}
								name={group}
								value={o.code}
							/>{" "}
							{o.label}
						</label>
					))}
				</div>
			);
		case "number":
			return (
				<label className="number">
					<input
						type="number"
						min={input.min}
						max={input.max}
						step={input.step}
						aria-label="Answer"
					/>{" "}
					{input.unit}
				</label>
			);
		case "text":
			return (
				<textarea rows={3} maxLength={input.maxLength} aria-label="Answer" />
			);
		default:
			return input satisfies never;
	}
}

/** A shared file, as the DDI names it back (`sharedOf`). */
export type Shared = NonNullable<ReturnType<typeof sharedOf>>;

/**
 * Where a shared name goes: its chip wrapped in a link to its file, by the view that
 * knows the files, or undefined when it has no such file. No `Follow`, for another
 * author's version, where nothing is followed.
 */
export type Follow = (shared: Shared, chip: ReactNode) => ReactNode | undefined;

/**
 * A shared name as the view has it: green, and a link to its file where one is
 * followed; undefined for a name the view has no file for (green means a shared name).
 */
function sharedName(
	shared: Shared,
	name: string,
	follow: Follow | undefined,
): ReactNode | undefined {
	const chip = <code className="code code-ref">{name}</code>;
	return follow === undefined ? chip : follow(shared, chip);
}

/** A shared name in text: plain code, not green, where the view has no file for it. */
function SharedName({
	shared,
	name,
	follow,
}: {
	shared: Shared;
	name: string;
	follow: Follow | undefined;
}) {
	return (
		sharedName(shared, name, follow) ?? <code className="code">{name}</code>
	);
}

/** A span of a codebook's text: a fill as the gap it is (`[rent]`), as the respondent's pane shows it. */
function SpanView({ span, follow }: { span: Span; follow?: Follow }) {
	switch (span.kind) {
		case "text":
			return <>{span.text}</>;
		case "code":
			return <code className="code">{span.text}</code>;
		case "link":
			return <ExternalLink href={span.url}>{span.text}</ExternalLink>;
		case "ref": {
			if (span.type.endsWith("Parameter"))
				return <span className="fill-slot">[{span.name ?? UNNAMED}]</span>;
			const shared = sharedOf(span.urn);
			return shared === undefined ? (
				span.name
			) : (
				<SharedName
					shared={shared}
					name={span.name ?? shared.name}
					follow={follow}
				/>
			);
		}
		default:
			return span satisfies never;
	}
}

/** Text where a paragraph can't go (a heading, a cell): its paragraphs run on. */
function Inline({ text, follow }: { text: Text; follow?: Follow }) {
	return text.map((para, i) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: paragraphs and spans are positional
		<Fragment key={i}>
			{i > 0 && " "}
			{para.map((span, j) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: positional
				<SpanView key={j} span={span} {...(follow && { follow })} />
			))}
		</Fragment>
	));
}

function Paragraphs({ text, follow }: { text: Text; follow?: Follow }) {
	return text.map((para, i) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: paragraphs are positional
		<p key={i}>
			<Inline text={[para]} {...(follow && { follow })} />
		</p>
	));
}

/** One `<dt>` and its `<dd>`, nothing when there is nothing to say. */
function Pair({ term, children }: { term: string; children: ReactNode }) {
	return children === undefined || children === false ? null : (
		<>
			<dt>{term}</dt>
			<dd>{children}</dd>
		</>
	);
}

/**
 * Shared items as the entry names them: a shared concept's label (a universe's words),
 * then its name; words the question wrote itself, as they are.
 */
function Named({
	refs,
	described,
	follow,
}: {
	refs: readonly Ref[];
	described: readonly Described[];
	follow?: Follow;
}) {
	return refs.map((r) => {
		const shared = sharedOf(r.urn);
		const item = described.find((d) => itemKeyOf(d.urn) === itemKeyOf(r.urn));
		const words = item?.label ?? item?.description;
		return (
			<p key={r.urn}>
				{shared === undefined ? (
					(r.name ?? (words && <Inline text={words} />))
				) : (
					<>
						{words && (
							<>
								<Inline text={words} />{" "}
							</>
						)}
						<SharedName
							shared={shared}
							name={r.name ?? shared.name}
							follow={follow}
						/>
					</>
				)}
			</p>
		);
	});
}

/** The shared lists a table's rows come from, as the view has them, " and " between. */
function listsOf(
	from: readonly Ref[],
	follow: Follow | undefined,
): ReactNode | undefined {
	const names = from.flatMap((r) => {
		const shared = sharedOf(r.urn);
		const node =
			shared === undefined
				? undefined
				: sharedName(shared, r.name ?? shared.name, follow);
		return node === undefined ? [] : [{ key: r.urn, node }];
	});
	return names.length === 0 ? undefined : (
		<span className="quiet">
			{" "}
			from{" "}
			{names.map(({ key, node }, i) => (
				<Fragment key={key}>
					{i > 0 && " and "}
					{node}
				</Fragment>
			))}
		</span>
	);
}

/**
 * Codes and their labels, valid ones first, then missing ones under a heading of their
 * own, as the codebook page draws them; each part says the shared list it comes from.
 */
function Values({
	rows,
	from,
	caption,
	follow,
}: {
	rows: readonly Row[];
	from: readonly Ref[];
	caption?: string;
	follow?: Follow;
}) {
	if (rows.length === 0) return null;
	const valid = rows.filter((r) => !r.missing);
	const missing = rows.filter((r) => r.missing);
	const isMissing = (r: Ref) => sharedOf(r.urn)?.kind === "missing";
	const validFrom = listsOf(
		from.filter((r) => !isMissing(r)),
		follow,
	);
	const missingFrom = listsOf(from.filter(isMissing), follow);
	const body = (rs: readonly Row[]) =>
		rs.map((r) => (
			<tr key={r.code}>
				<th scope="row">
					<code className="code">{r.code}</code>
				</th>
				<td>{r.label && <Inline text={r.label} />}</td>
			</tr>
		));
	return (
		<table className="cb-table">
			<caption>
				{caption ?? (valid.length === 0 ? "Missing values" : "Values")}
				{valid.length === 0 ? missingFrom : validFrom}
			</caption>
			<thead>
				<tr>
					<th scope="col">Code</th>
					<th scope="col">Label</th>
				</tr>
			</thead>
			{valid.length === 0 ? (
				<tbody>{body(missing)}</tbody>
			) : (
				<>
					<tbody>{body(valid)}</tbody>
					{missing.length > 0 && (
						<tbody>
							<tr>
								<th scope="rowgroup" colSpan={2}>
									Missing values{missingFrom}
								</th>
							</tr>
							{body(missing)}
						</tbody>
					)}
				</>
			)}
		</table>
	);
}

/** An entry's particulars: what it measures, of whom, why, in what form, and its notes. */
function Particulars({
	e,
	codebook,
	follow,
}: {
	e: Entry;
	codebook: CodebookModel;
	follow?: Follow;
}) {
	const rows = e.responses?.rows ?? [];
	const missing = rows.filter((r) => r.missing);
	return (
		<dl className="cb-meta">
			<Pair term="Concept">
				{e.concepts.length > 0 && (
					<Named
						refs={e.concepts}
						described={codebook.shared.concepts}
						{...(follow && { follow })}
					/>
				)}
			</Pair>
			<Pair term="Universe">
				{e.universes.length > 0 && (
					<Named
						refs={e.universes}
						described={codebook.shared.universes}
						{...(follow && { follow })}
					/>
				)}
			</Pair>
			<Pair term="Intent">{e.intent && <Paragraphs text={e.intent} />}</Pair>
			<Pair term="Answers">
				{e.responses?.many === true && "Select all that apply"}
			</Pair>
			<Pair term="Format">{e.format && formatWords(e.format)}</Pair>
			<Pair term="Missing values">
				{missing.length > 0 &&
					missing.length < rows.length &&
					missing.map((r, i) => (
						<Fragment key={r.code}>
							{i > 0 && ", "}
							<code className="code">{r.code}</code>
						</Fragment>
					))}
			</Pair>
			<Pair term="Notes">{e.notes && <Paragraphs text={e.notes} />}</Pair>
			<Pair term="Source">
				{e.source?.text && <Paragraphs text={e.source.text} />}
			</Pair>
		</dl>
	);
}

/** The question's words, as quoted, then what the interviewer is told. */
function QuestionWords({
	q,
	follow,
}: {
	q: NonNullable<Entry["question"]>;
	follow?: Follow;
}) {
	return (
		<>
			{q.text && (
				<blockquote className="cb-text">
					<Paragraphs text={q.text} {...(follow && { follow })} />
				</blockquote>
			)}
			{q.instructions.map((i, n) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: instructions are positional
				<div key={n} className="quiet">
					<Paragraphs text={i} {...(follow && { follow })} />
				</div>
			))}
		</>
	);
}

/** A heading's words: the name as code (or that there is none yet), then the label. */
function Title({ name, label }: { name?: string; label?: Text }) {
	return (
		<h4>
			{name === undefined ? (
				<span className="quiet">{UNNAMED}</span>
			) : (
				<code className="code">{name}</code>
			)}
			{label && (
				<>
					{" "}
					<Inline text={label} />
				</>
			)}
		</h4>
	);
}

/**
 * The question as its DDI's codebook lists it: each variable it records (or the
 * question, while it records none), drawn from the codebook model of the DDI the DDI
 * pane shows. What the DDI doesn't hold isn't here: an empty field is absent, and the
 * Findings pane lists what is left to fill in. A select-all question's words once, its
 * options in one table, then the values each records.
 */
export function Codebook({
	codebook,
	follow,
}: {
	codebook: CodebookModel;
	follow?: Follow;
}) {
	const opt = follow === undefined ? {} : { follow };
	return (
		<div className="codebook">
			{blocksOf(codebook.entries).map((b) => {
				if (b.kind === "entry") {
					const e = b.entry;
					return (
						<section key={e.urn} className="cb-entry">
							<Title
								{...(e.name !== undefined && { name: e.name })}
								{...(e.label !== undefined && { label: e.label })}
							/>
							{e.question && <QuestionWords q={e.question} {...opt} />}
							<Particulars e={e} codebook={codebook} {...opt} />
							<Values
								rows={e.responses?.rows ?? []}
								from={e.responses?.from ?? []}
								{...opt}
							/>
						</section>
					);
				}
				const [first] = b.options;
				return (
					<section key={b.question.urn} className="cb-entry">
						<Title
							{...(b.question.name !== undefined && { name: b.question.name })}
						/>
						<QuestionWords q={b.question} {...opt} />
						<p className="quiet">
							Select all that apply, each option a variable of its own
						</p>
						<table className="cb-table">
							<caption>Options</caption>
							<thead>
								<tr>
									<th scope="col">Code</th>
									<th scope="col">Option</th>
									<th scope="col">Variable</th>
								</tr>
							</thead>
							<tbody>
								{b.options.map((o) => (
									<tr key={o.urn}>
										<th scope="row">
											<code className="code">{o.group?.option.code}</code>
										</th>
										<td>
											{o.group?.option.label && (
												<Inline text={o.group.option.label} />
											)}
										</td>
										<td>
											{o.name !== undefined && (
												<code className="code">{o.name}</code>
											)}{" "}
											{o.label && <Inline text={o.label} />}
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{first && (
							<>
								<Particulars e={first} codebook={codebook} {...opt} />
								<Values
									rows={first.responses?.rows ?? []}
									from={first.responses?.from ?? []}
									caption="Each option's values"
									{...opt}
								/>
							</>
						)}
					</section>
				);
			})}
		</div>
	);
}

/**
 * The codebook pane: the codebook, or why its DDI can't be read. The app's own documents
 * always read; another's may not.
 */
export function CodebookPane({
	read,
	follow,
}: {
	read: Result<CodebookModel, readonly CodebookFinding[]>;
	follow?: Follow;
}) {
	return read.ok ? (
		<Codebook codebook={read.value} {...(follow && { follow })} />
	) : (
		<InlineMessage variant="critical">
			The codebook can't be read: {read.error.map((f) => f.message).join(" ")}
		</InlineMessage>
	);
}

/**
 * Said beside the DDI while the workspace declares no valid agency: its items are published
 * under the placeholder, and this is where to add one.
 */
export function AgencyNotice({ declare }: { declare: () => void }) {
	return (
		<InlineMessage variant="warning">
			<span>
				This workspace declares no valid DDI agency yet, so its items are
				published under <code className="code">{UNDECLARED_AGENCY}</code>.{" "}
				<Link as="button" type="button" onClick={declare}>
					Add the workspace's agency
				</Link>
			</span>
		</InlineMessage>
	);
}

/** Shared text shows the scheme name it came from, so the author sees it is not theirs to reword here. */
function ResolvedText({ value }: { value: Resolved }) {
	return (
		<>
			{value.text}
			{value.ref !== undefined && <span className="ref">{value.ref}</span>}
		</>
	);
}
