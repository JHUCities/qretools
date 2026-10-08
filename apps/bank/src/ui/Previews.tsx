/** The previews, drawn from the core's render models. They decide nothing. */

import { Link } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import {
	type CodebookView,
	type Hole,
	type Input,
	type Resolved,
	type RespondentView,
	type Slot,
	type TextSlot,
	UNDECLARED_AGENCY,
} from "@qretools/core";
import type { OnTarget } from "@qretools/shell/ui";
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
			<p className="cb-text">{textSlot(view.text, onTarget)}</p>
			{view.values.kind === "hole" ? (
				<HoleButton hole={view.values} onTarget={onTarget} />
			) : (
				<ul className="cb-values">
					{view.values.lines.map((l) => (
						<li key={l}>{l}</li>
					))}
				</ul>
			)}
			{/*
			 * The entry's particulars, as the BAS codebook lists them: terms and their values.
			 * Concept is ours (BAS lists none): what is measured, before who is asked.
			 */}
			<dl className="cb-meta">
				{view.concept !== undefined && (
					<>
						<dt>Concept</dt>
						<dd>
							<ResolvedText value={view.concept} />
						</dd>
					</>
				)}
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

/**
 * Said beside the DDI while the bank declares no valid agency: its items are published
 * under the placeholder, and this is where to add one.
 */
export function AgencyNotice({ declare }: { declare: () => void }) {
	return (
		<InlineMessage variant="warning">
			<span>
				This bank declares no valid DDI agency yet, so its items are published
				under <code className="code">{UNDECLARED_AGENCY}</code>.{" "}
				<Link as="button" type="button" onClick={declare}>
					Add the bank's agency
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
