/**
 * A file that is on its way, in the shape it will have: Primer's skeletons where the
 * text will be, the panes' real headings (structure, not data, so the outline is
 * stable and nothing shifts when the file arrives). Decorative: the top bar's status
 * says what is loading, once. A fragment, so its parts take the content's rows.
 */
import { ArrowLeftIcon } from "@primer/octicons-react";
import { Button, PageHeader } from "@primer/react";
import { SkeletonText } from "@primer/react/experimental";
import { SCHEME_SINGULAR } from "../../core/copy.js";
import type { SchemeKind } from "../../core/schemes.js";

/** The preview panes a file of each kind shows, by heading; Editing.tsx draws the same. */
export function paneTitles(kind: "question" | SchemeKind): readonly string[] {
	return kind === "question"
		? ["Findings", "As the respondent sees it", "As the codebook lists it"]
		: ["Findings", SCHEME_SINGULAR[kind], "Used by"];
}

/** Ragged, like YAML: the widths are decoration, not measurements. */
const CODE = ["40%", "70%", "85%", "55%", "30%", "65%", "45%", "75%"];

export function FileSkeleton({
	kind,
	onBack,
}: {
	kind: "question" | SchemeKind;
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
				<div className="left skeleton-code">
					{CODE.map((width, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed decoration
						<SkeletonText key={i} size="bodySmall" maxWidth={width} />
					))}
				</div>
				<div className="right">
					{paneTitles(kind).map((title) => (
						<article className="pane" key={title}>
							<h3>{title}</h3>
							<div className="pane-body">
								<SkeletonText lines={3} />
							</div>
						</article>
					))}
				</div>
			</div>
		</>
	);
}
