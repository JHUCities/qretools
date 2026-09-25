/** The open file's header: identity, state, and the actions on it. */
import { DownloadIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";
import { Banner, Button, Label, PageHeader, Stack } from "@primer/react";
import { useId } from "react";
import type { Activity, Entry } from "../model.js";
import { inlineCode } from "./Previews.js";

export interface HeaderActions {
	readonly save: () => void;
	readonly reload: () => void;
	readonly remove: () => void;
	readonly downloadYaml: () => void;
	/** Absent for a file that is not a question: only a question elaborates to DDI. */
	readonly downloadDdi: (() => void) | undefined;
	/** Absent for a file that cannot move: a draft, or a scheme file (named by its path). */
	readonly move?: () => void;
}

export function FileHeader({
	q,
	name,
	kind,
	unsaved,
	activity,
	blocked,
	also = [],
	stale = false,
	on,
}: {
	q: Entry;
	activity: Activity | undefined;
	name: string | undefined;
	/** What the file is, when it is not a question: "scale", "universe", … */
	kind?: string;
	unsaved: boolean;
	/** Why nothing can be written now (`writeBlocked`), or undefined. */
	blocked: string | undefined;
	/** Unsaved shared files this save takes along (`alsoSaves`). */
	also?: readonly string[];
	/**
	 * GitHub changed this file since the author started (a conflict, or deleted there):
	 * "Reload from GitHub" belongs here, decided by the file's own state, never by which
	 * file a refused save happened to report on.
	 */
	stale?: boolean;
	on: HeaderActions;
}) {
	const canWrite = blocked === undefined;
	const statusId = useId();
	const reload = (
		<Banner.PrimaryAction leadingVisual={SyncIcon} onClick={on.reload}>
			Reload from GitHub
		</Banner.PrimaryAction>
	);
	const saving = activity?.kind === "saving";
	const nothing = !unsaved && also.length === 0;
	// Why a write cannot happen now, said in visible text that the inactive buttons
	// point to: a disabled button can neither be focused nor explain itself.
	const status =
		blocked ??
		(nothing
			? "All changes saved."
			: also.length > 0
				? `Saving also saves ${also.join(", ")}.`
				: "Unsaved changes.");
	// An inactive button stays focusable and announced; its click does nothing.
	const when =
		(ok: boolean, f: () => void): (() => void) =>
		() => {
			if (ok) f();
		};
	return (
		<div className="qhead">
			<PageHeader>
				<PageHeader.TitleArea variant="subtitle">
					<PageHeader.Title as="h2">
						{kind !== undefined && <span className="quiet">{kind} </span>}
						{name ?? <span className="quiet">(no name yet)</span>}
					</PageHeader.Title>
					<PageHeader.TrailingVisual>
						<Stack direction="horizontal" gap="condensed">
							{q.base !== undefined ? (
								<Label>in bank</Label>
							) : (
								<Label variant="attention">draft</Label>
							)}
							{unsaved && <Label variant="attention">unsaved</Label>}
						</Stack>
					</PageHeader.TrailingVisual>
				</PageHeader.TitleArea>
				<PageHeader.Actions>
					<Button
						size="small"
						leadingVisual={DownloadIcon}
						onClick={on.downloadYaml}
					>
						YAML
					</Button>
					{on.downloadDdi !== undefined && (
						<Button
							size="small"
							leadingVisual={DownloadIcon}
							onClick={on.downloadDdi}
						>
							DDI
						</Button>
					)}
					{on.move !== undefined && (
						<Button
							size="small"
							inactive={q.base === undefined || !canWrite}
							aria-disabled={q.base === undefined || !canWrite || undefined}
							aria-describedby={statusId}
							onClick={when(q.base !== undefined && canWrite, on.move)}
						>
							Move…
						</Button>
					)}
					<Button
						size="small"
						variant="danger"
						leadingVisual={TrashIcon}
						inactive={q.base !== undefined && !canWrite}
						aria-disabled={(q.base !== undefined && !canWrite) || undefined}
						aria-describedby={statusId}
						loading={activity?.kind === "deleting"}
						loadingAnnouncement="Deleting"
						onClick={when(q.base === undefined || canWrite, on.remove)}
					>
						Delete…
					</Button>
					<Button
						size="small"
						variant="primary"
						inactive={!canWrite || nothing}
						aria-disabled={!canWrite || nothing || undefined}
						aria-describedby={statusId}
						loading={saving}
						loadingAnnouncement="Saving"
						onClick={when(canWrite && !nothing && !saving, on.save)}
					>
						Save
					</Button>
				</PageHeader.Actions>
				<PageHeader.Description>
					<span id={statusId} className="quiet qhead-status">
						{status}
					</span>
				</PageHeader.Description>
			</PageHeader>
			{activity?.kind === "failed" && (
				<Banner
					variant="critical"
					title={activity.failure.message}
					description={
						activity.failure.hint === undefined
							? undefined
							: inlineCode(activity.failure.hint)
					}
					primaryAction={stale ? reload : undefined}
				/>
			)}
			{stale && activity?.kind !== "failed" && (
				<Banner
					variant="warning"
					title="This file changed on GitHub since you started."
					description="Download your version first if you want to keep it, then reload from GitHub."
					primaryAction={reload}
				/>
			)}
		</div>
	);
}
