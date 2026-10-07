/**
 * A file that is on its way, in the shape it will have: Primer's skeletons where the
 * text will be, the panes' real headings (structure, not data, so the outline is
 * stable and nothing shifts when the file arrives). Decorative: the top bar's status
 * says what is loading, once. A fragment, so its parts take the content's rows.
 *
 * Which panes a file shows is decided here, once (`panesOf`), and both this skeleton
 * and the loaded views draw them through `Panes`, so the two cannot disagree.
 */
import { ArrowLeftIcon } from "@primer/octicons-react";
import { Button, PageHeader } from "@primer/react";
import { SkeletonText } from "@primer/react/experimental";
import { SCHEME_SINGULAR } from "@qretools/core/copy.js";
import type { SchemeKind } from "@qretools/core/schemes.js";
import type { ReactNode } from "react";

export type FileKind = "question" | SchemeKind;
export type PaneId =
	| "findings"
	| "respondent"
	| "codebook"
	| "value"
	| "usedBy";

/**
 * The preview panes a file shows, in order. Another author's version (read only) has
 * no "Used by": who names a shared file is known only for your own bank.
 */
export function panesOf(
	kind: FileKind,
	readOnly: boolean,
): readonly { readonly id: PaneId; readonly title: string }[] {
	if (kind === "question")
		return [
			{ id: "findings", title: "Findings" },
			{ id: "respondent", title: "As the respondent sees it" },
			{ id: "codebook", title: "As the codebook lists it" },
		];
	return [
		{ id: "findings", title: "Findings" },
		{ id: "value", title: SCHEME_SINGULAR[kind] },
		...(readOnly ? [] : [{ id: "usedBy" as const, title: "Used by" }]),
	];
}

/** Only a question you can edit has a cursor inspector under its editor. */
export const hasInspector = (kind: FileKind, readOnly: boolean): boolean =>
	kind === "question" && !readOnly;

/** The panes `panesOf` lists: each a heading (plus an optional badge) and a body. */
export function Panes({
	kind,
	readOnly,
	badge = {},
	body,
}: {
	kind: FileKind;
	readOnly: boolean;
	badge?: Partial<Record<PaneId, ReactNode>>;
	body: (id: PaneId) => ReactNode;
}) {
	return panesOf(kind, readOnly).map(({ id, title }) => (
		<article className="pane" key={id}>
			<h3>
				{title} {badge[id]}
			</h3>
			<div className="pane-body">{body(id)}</div>
		</article>
	));
}

/** Ragged, like YAML: the widths are decoration, not measurements. */
const CODE = ["40%", "70%", "85%", "55%", "30%", "65%", "45%", "75%"];

export function FileSkeleton({
	kind,
	readOnly = false,
	onBack,
}: {
	kind: FileKind;
	/** Another author's version: no inspector, no "Used by". */
	readOnly?: boolean;
	/** With a way back, the header is drawn too (a link waiting for the bank). */
	onBack?: () => void;
}) {
	return (
		<>
			{onBack !== undefined && (
				<div className="qhead">
					<PageHeader>
						<PageHeader.ContextArea>
							<Button
								className="back"
								variant="invisible"
								size="small"
								leadingVisual={ArrowLeftIcon}
								onClick={onBack}
							>
								Back to the bank
							</Button>
						</PageHeader.ContextArea>
						<PageHeader.TitleArea variant="subtitle">
							<PageHeader.Title as="h2">
								<span className="skeleton-title">
									<SkeletonText size="titleMedium" />
								</span>
							</PageHeader.Title>
						</PageHeader.TitleArea>
					</PageHeader>
				</div>
			)}
			<div className="split">
				<div className="left">
					<div className="editor skeleton-code">
						{CODE.map((width, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed decoration
							<SkeletonText key={i} size="bodySmall" maxWidth={width} />
						))}
					</div>
					{hasInspector(kind, readOnly) && <div className="inspector" />}
				</div>
				<div className="right">
					<Panes
						kind={kind}
						readOnly={readOnly}
						body={() => <SkeletonText lines={3} />}
					/>
				</div>
			</div>
		</>
	);
}
