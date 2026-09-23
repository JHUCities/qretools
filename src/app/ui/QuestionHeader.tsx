/** The open question's header: identity, state, and the actions on it. */
import { DownloadIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";
import { Banner, Button, Label } from "@primer/react";
import type { Question, Session } from "../model.js";
import { inlineCode } from "./Previews.js";

export interface HeaderActions {
	readonly save: () => void;
	readonly reload: () => void;
	readonly remove: () => void;
	readonly downloadYaml: () => void;
	readonly downloadDdi: () => void;
}

export function QuestionHeader({
	q,
	name,
	unsaved,
	session,
	on,
}: {
	q: Question;
	name: string | undefined;
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
				<Button
					size="small"
					leadingVisual={DownloadIcon}
					onClick={on.downloadDdi}
				>
					DDI
				</Button>
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
