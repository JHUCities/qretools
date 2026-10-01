/** The previews, drawn from the core's render models. They decide nothing. */

import {
	AlertIcon,
	CheckCircleIcon,
	ChevronRightIcon,
	InfoIcon,
	IssueDraftIcon,
	XCircleIcon,
} from "@primer/octicons-react";
import { Details, Label, Link } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { Fragment, memo, type ReactNode, useId } from "react";
import { codeSpans } from "../../core/codeSpans.js";
import { toFillIn } from "../../core/copy.js";
import type { DdiDocument } from "../../core/ddi/document.js";
import type { Finding, Fix, Status, Target } from "../../core/findings.js";
import type {
	CodebookView,
	Hole,
	Input,
	Resolved,
	RespondentView,
	Slot,
} from "../../core/render.js";
import type { DdiSchema } from "../model.js";

/** Where a click on a hole or finding goes; absent in a read-only view, where nothing is clickable. */
type OnTarget = ((target: Target) => void) | undefined;

/** Messages mark field names with backticks (`codeSpans`); show those as code. */
export const inlineCode = (text: string): ReactNode[] =>
	codeSpans(text).map((s, i) =>
		s.code ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: the pieces of a split string have no identity but their position
			<code key={i} className="code">
				{s.text}
			</code>
		) : (
			s.text
		),
	);

/** A banner's description: the hint, then any library detail, quieter. */
export const failureDescription = (f: {
	readonly hint?: string;
	readonly detail?: string;
}): ReactNode =>
	f.hint === undefined && f.detail === undefined ? undefined : (
		<>
			{f.hint !== undefined && inlineCode(f.hint)}
			{f.detail !== undefined && <span className="detail">{f.detail}</span>}
		</>
	);

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

export function StatusBadge({ status }: { status: Status }) {
	switch (status.kind) {
		case "complete":
			return <Label variant="success">complete</Label>;
		case "advice":
			return (
				<Label variant={status.worst === "warning" ? "attention" : "accent"}>
					{status.count === 1
						? "1 piece of advice"
						: `${status.count} pieces of advice`}
				</Label>
			);
		case "incomplete":
			return (
				<Label variant={status.errors > 0 ? "danger" : "attention"}>
					{[
						status.holes > 0 && toFillIn(status.holes),
						status.errors > 0 && `${status.errors} to fix`,
					]
						.filter(Boolean)
						.join(", ")}
				</Label>
			);
		default:
			return status satisfies never;
	}
}

/** A file's verdict as one icon: its most severe finding's, as the Findings list draws it. */
export function StatusIcon({ status }: { status: Status }) {
	if (status.kind === "complete")
		return (
			<CheckCircleIcon size={14} className="fg-success" aria-label="complete" />
		);
	const worst =
		status.kind === "advice"
			? status.worst
			: status.errors > 0
				? "error"
				: "hole";
	const { Icon, className } = SEVERITY[worst];
	return (
		<Icon size={14} className={className} aria-label={SEVERITY_LABEL[worst]} />
	);
}

export function Respondent({
	view,
	onTarget,
}: {
	view: RespondentView;
	onTarget?: OnTarget;
}) {
	return (
		<fieldset className="respondent">
			<legend>{slot(view.text, onTarget)}</legend>
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

export function Codebook({
	view,
	onTarget,
}: {
	view: CodebookView;
	onTarget?: OnTarget;
}) {
	return (
		<div className="codebook">
			<p className="cb-title">
				{slot(view.title, onTarget)}{" "}
				<span className="cb-var">
					Variable: {slot(view.variable, onTarget)}
				</span>
			</p>
			<p className="cb-text">{slot(view.text, onTarget)}</p>
			{view.values.kind === "hole" ? (
				<HoleButton hole={view.values} onTarget={onTarget} />
			) : (
				<ul className="cb-values">
					{view.values.lines.map((l) => (
						<li key={l}>{l}</li>
					))}
				</ul>
			)}
			{/* The entry's particulars, as the BAS codebook lists them: terms and their values. */}
			<dl className="cb-meta">
				{view.universe !== undefined && (
					<>
						<dt>Universe</dt>
						<dd>
							<ResolvedText value={view.universe} />
						</dd>
					</>
				)}
				{view.missing !== undefined && (
					<>
						<dt>Missing</dt>
						<dd>{view.missing}</dd>
					</>
				)}
				{view.source !== undefined && (
					<>
						<dt>Source</dt>
						<dd>{view.source}</dd>
					</>
				)}
				{view.notes.map((n) => (
					<Fragment key={n}>
						<dt>Note</dt>
						<dd>{n}</dd>
					</Fragment>
				))}
			</dl>
		</div>
	);
}

/** Each severity's icon and colour: a hole is a dashed circle, an invitation, never red. */
const SEVERITY = {
	hole: { Icon: IssueDraftIcon, className: "fg-attention" },
	error: { Icon: XCircleIcon, className: "fg-danger" },
	warning: { Icon: AlertIcon, className: "fg-attention" },
	info: { Icon: InfoIcon, className: "fg-accent" },
} as const;

/** A severity as the author reads it: "hole" is the tool's word, not theirs. */
const SEVERITY_LABEL: Readonly<Record<Finding["severity"], string>> = {
	hole: "to fill in",
	error: "error",
	warning: "warning",
	info: "info",
};

/**
 * The findings: one list, editable or not; severity is an icon with its name, never
 * colour alone. Editable, the message takes the author to its place in the source, and
 * a fix or another file's link follows it as a text link. Not Primer's ActionList: an
 * item is one button, so nothing interactive can sit inside it, and read only it would
 * render buttons that do nothing (Primer 38's Item.js).
 */
/**
 * A key per finding that survives edits elsewhere in the text: what it says and where,
 * plus which occurrence it is when the same finding is reported twice. A finding that
 * stays keeps its element (and its focus); only a new one enters.
 */
export const findingKeys = (
	findings: readonly Finding[],
): readonly string[] => {
	const seen = new Map<string, number>();
	return findings.map((f) => {
		const id = `${f.code}\u0000${f.path}\u0000${f.message}`;
		const n = seen.get(id) ?? 0;
		seen.set(id, n + 1);
		return `${id}\u0000${n}`;
	});
};

/** Another file a finding is about, as a link beside it (a draft has no address, so none). */
export interface Related {
	readonly href: string;
	readonly label: string;
}

export function Findings({
	findings,
	onTarget,
	related,
	onFix,
}: {
	findings: readonly Finding[];
	onTarget?: OnTarget;
	/** The other file a bank-level finding names, opened by an ordinary link. */
	related?: (f: Finding) => Related | undefined;
	/** Apply a finding's quick fix; absent where nothing can be edited. */
	onFix?: (fix: Fix) => void;
}) {
	if (findings.length === 0)
		return <p className="quiet">Nothing to fill in, fix, or reconsider.</p>;
	const keys = findingKeys(findings);
	return (
		// A plain list, editable or not: a fix and a link sit under the message, as
		// GitHub offers "Create a new release" under "No releases published", which an
		// ActionList item (one button) cannot hold. `role="list"`: Safari's VoiceOver
		// drops list semantics from a list without bullets.
		// biome-ignore lint/a11y/noRedundantRoles: VoiceOver, above
		<ul className="findings" role="list" aria-label="Findings">
			{findings.map((f, i) => {
				const { Icon, className } = SEVERITY[f.severity];
				const other = related?.(f);
				const fix = onFix === undefined ? undefined : f.fix;
				const message = inlineCode(f.message);
				return (
					<li key={keys[i]} className="finding">
						<Icon
							className={`${className} finding-icon`}
							aria-label={SEVERITY_LABEL[f.severity]}
						/>
						<div className="finding-body">
							{onTarget === undefined ? (
								<span className="finding-message">{message}</span>
							) : (
								// The message goes to its place in the source.
								<Link
									as="button"
									type="button"
									className="finding-message"
									onClick={() => onTarget(f)}
								>
									{message}
								</Link>
							)}
							{f.hint !== undefined && (
								<span className="finding-hint">{inlineCode(f.hint)}</span>
							)}
							{f.detail !== undefined && (
								<span className="detail">{f.detail}</span>
							)}
							{fix !== undefined && (
								<Link
									as="button"
									type="button"
									className="finding-action"
									// Where focus goes next is `update`'s: into the source for an edit,
									// the name dialog for a new shared entry.
									onClick={() => onFix?.(fix)}
								>
									{inlineCode(fix.label)}
								</Link>
							)}
							{other !== undefined && (
								<Link className="finding-action" href={other.href}>
									{other.label}
								</Link>
							)}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

/** Memoised: stringifying the whole DDI document must not ride every caret move. */
export const Ddi = memo(function Ddi({
	document,
	schema,
	problems,
}: {
	document: DdiDocument;
	schema: DdiSchema;
	problems: readonly Finding[];
}) {
	const badge =
		schema.kind === "loading" ? (
			<Label>loading schema…</Label>
		) : problems.length === 0 ? (
			<Label variant="success">valid against the official schema</Label>
		) : (
			<Label variant="danger">
				{problems.length === 1
					? "1 schema problem"
					: `${problems.length} schema problems`}
			</Label>
		);
	return (
		// Primer's Details hides the browser's marker; the chevron stands in for it,
		// on the heading's line.
		<Details className="pane">
			<Details.Summary>
				<h3>
					<span className="disclosure">
						<ChevronRightIcon aria-hidden />
						DDI-Lifecycle 4.0
					</span>
					{badge}
				</h3>
			</Details.Summary>
			<div className="pane-body">
				{problems.map((f, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: schema problems are positional and can repeat
					<InlineMessage variant="critical" key={i}>
						<span>
							{inlineCode(f.message)}
							{f.detail !== undefined && (
								<span className="detail">{f.detail}</span>
							)}
						</span>
					</InlineMessage>
				))}
				<pre className="json">{JSON.stringify(document, null, 2)}</pre>
			</div>
		</Details>
	);
});

/** Shared text shows the scheme name it came from, so the author sees it is not theirs to reword here. */
function ResolvedText({ value }: { value: Resolved }) {
	return (
		<>
			{value.text}
			{value.ref !== undefined && <span className="ref">{value.ref}</span>}
		</>
	);
}
