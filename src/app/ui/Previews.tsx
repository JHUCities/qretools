/** The previews, drawn from the core's render models. They decide nothing. */
import {
	AlertIcon,
	CheckCircleIcon,
	InfoIcon,
	IssueOpenedIcon,
} from "@primer/octicons-react";
import { Label } from "@primer/react";
import { memo, type ReactNode } from "react";
import type { DdiDocument } from "../../core/ddi/document.js";
import type { Finding, Status, Target } from "../../core/findings.js";
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

/** Messages mark field names with backticks (a core/shell convention); show those as code. */
export function inlineCode(text: string): ReactNode[] {
	const out: ReactNode[] = [];
	text.split("`").forEach((part, i) => {
		// biome-ignore lint/suspicious/noArrayIndexKey: the pieces of a split string have no identity but their position
		out.push(i % 2 === 1 ? <code key={i}>{part}</code> : part);
	});
	return out;
}

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
				<Label variant="accent">
					{status.count === 1
						? "1 piece of advice"
						: `${status.count} pieces of advice`}
				</Label>
			);
		case "incomplete":
			return (
				<Label variant={status.errors > 0 ? "danger" : "attention"}>
					{[
						status.holes > 0 && `${status.holes} to fill in`,
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

export function StatusIcon({ status }: { status: Status }) {
	if (status.kind === "complete")
		return (
			<CheckCircleIcon size={14} className="fg-success" aria-label="complete" />
		);
	if (status.kind === "advice")
		return <InfoIcon size={14} className="fg-accent" aria-label="advice" />;
	return status.errors > 0 ? (
		<AlertIcon size={14} className="fg-danger" aria-label="errors" />
	) : (
		<IssueOpenedIcon size={14} className="fg-attention" aria-label="holes" />
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
	switch (input.kind) {
		case "hole":
			return <HoleButton hole={input} onTarget={onTarget} />;
		case "choice":
			// Inputs sit inside their labels, and the group name is constant: author-spelled
			// codes make poor ids, and `name` may still be a hole.
			return (
				<div className="options">
					{input.options.map((o) => (
						<label key={o.code}>
							<input
								type={input.select === "one" ? "radio" : "checkbox"}
								name="response"
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
			{view.universe !== undefined && (
				<p className="cb-meta">
					<b>Universe: </b>
					<ResolvedText value={view.universe} />
				</p>
			)}
			{view.missing !== undefined && <p className="cb-meta">{view.missing}</p>}
			{view.source !== undefined && (
				<p className="cb-meta">
					<b>Source: </b>
					{view.source}
				</p>
			)}
			{view.notes.map((n) => (
				<p className="cb-meta" key={n}>
					<b>Note: </b>
					{n}
				</p>
			))}
		</div>
	);
}

export function Findings({
	findings,
	onTarget,
}: {
	findings: readonly Finding[];
	onTarget?: OnTarget;
}) {
	if (findings.length === 0)
		return <p className="quiet">Nothing to fill in, fix, or reconsider.</p>;
	return (
		<ul className="findings">
			{findings.map((f, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: findings are positional and the list is redrawn whole; identical findings can repeat
				<li key={i}>
					{onTarget === undefined ? (
						<div className={`finding ${f.severity}`}>
							<FindingBody f={f} />
						</div>
					) : (
						<button
							type="button"
							className={`finding ${f.severity}`}
							onClick={() => onTarget(f)}
						>
							<FindingBody f={f} />
						</button>
					)}
				</li>
			))}
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
		<details className="pane">
			<summary>
				<h3>DDI-Lifecycle 4.0 {badge}</h3>
			</summary>
			<div className="pane-body">
				{problems.map((f, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: schema problems are positional and can repeat
					<p className="finding error" key={i}>
						{inlineCode(f.message)}
					</p>
				))}
				<pre className="json">{JSON.stringify(document, null, 2)}</pre>
			</div>
		</details>
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

function FindingBody({ f }: { f: Finding }) {
	return (
		<>
			<span className="sev">{f.severity}</span>
			<span className="msg">{inlineCode(f.message)}</span>
			{f.hint !== undefined && <span className="hint">{f.hint}</span>}
		</>
	);
}
