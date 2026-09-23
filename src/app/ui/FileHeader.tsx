/** The open file's header: identity, state, and the actions on it. */
import { DownloadIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";
import { Banner, Button, Label } from "@primer/react";
import type { Entry, Session } from "../model.js";
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
	session,
	on,
}: {
	q: Entry;
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
				{q.origin.kind === "bank" ? (
					<Label>in bank</Label>
				) : (
					<Label variant="attention">draft</Label>
				)}
				{unsaved && <Label variant="attention">unsaved</Label>}
				{q.activity.kind === "saving" && <Label>saving…</Label>}
				{q.activity.kind === "deleting" && <Label>deleting…</Label>}
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
					disabled={q.origin.kind === "bank" && !canWrite}
					onClick={on.remove}
				>
					Delete…
				</Button>
				<Button
					size="small"
					variant="primary"
					disabled={!canWrite || !unsaved || q.activity.kind === "saving"}
					title={saveTitle}
					onClick={on.save}
				>
					Save
				</Button>
			</div>
			{q.activity.kind === "failed" && (
				<Banner
					variant="critical"
					title={q.activity.failure.message}
					description={
						q.activity.failure.hint === undefined
							? undefined
							: inlineCode(q.activity.failure.hint)
					}
					primaryAction={
						q.activity.failure.kind === "stale" && q.origin.kind === "bank" ? (
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
