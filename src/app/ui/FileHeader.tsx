/** The open file's header: identity, state, and the actions on it. */
import { DownloadIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";
import { Banner, Button, Label } from "@primer/react";
import type { Activity, Entry, Session } from "../model.js";
import { inlineCode } from "./Previews.js";

export interface HeaderActions {
	readonly save: () => void;
	readonly reload: () => void;
	readonly remove: () => void;
	readonly downloadYaml: () => void;
	/** Absent for a file that is not a question: only a question elaborates to DDI. */
	readonly downloadDdi: (() => void) | undefined;
}

export function FileHeader({
	q,
	name,
	kind,
	unsaved,
	activity,
	session,
	on,
}: {
	q: Entry;
	activity: Activity | undefined;
	name: string | undefined;
	/** What the file is, when it is not a question: "scale", "universe", … */
	kind?: string;
	unsaved: boolean;
	session: Session;
	on: HeaderActions;
}) {
	const canWrite = session.kind === "connected" && session.canWrite;
	const saveTitle =
		session.kind !== "connected"
			? "Connect to the bank to save"
			: !canWrite
				? "Read access only: download instead"
				: unsaved
					? "Save to the bank"
					: "Nothing to save";
	return (
		<div className="qhead">
			<div className="qhead-row">
				{kind !== undefined && <span className="quiet">{kind}</span>}
				<span className="qname">
					{name ?? <span className="quiet">(no name yet)</span>}
				</span>
				{q.base !== undefined ? (
					<Label>in bank</Label>
				) : (
					<Label variant="attention">draft</Label>
				)}
				{unsaved && <Label variant="attention">unsaved</Label>}
				{activity?.kind === "saving" && <Label>saving…</Label>}
				{activity?.kind === "deleting" && <Label>deleting…</Label>}
				<span className="spacer" />
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
				<Button
					size="small"
					variant="danger"
					leadingVisual={TrashIcon}
					disabled={q.base !== undefined && !canWrite}
					onClick={on.remove}
				>
					Delete…
				</Button>
				<Button
					size="small"
					variant="primary"
					disabled={!canWrite || !unsaved || activity?.kind === "saving"}
					title={saveTitle}
					onClick={on.save}
				>
					Save
				</Button>
			</div>
			{activity?.kind === "failed" && (
				<Banner
					variant="critical"
					title={activity.failure.message}
					description={
						activity.failure.hint === undefined
							? undefined
							: inlineCode(activity.failure.hint)
					}
					primaryAction={
						activity.failure.kind === "stale" && q.base !== undefined ? (
							<Banner.PrimaryAction
								leadingVisual={SyncIcon}
								onClick={on.reload}
							>
								Reload from GitHub
							</Banner.PrimaryAction>
						) : undefined
					}
				/>
			)}
		</div>
	);
}
