/** The open file's header: identity, state, and the actions on it. */

import { ArrowLeftIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";
import {
	Banner,
	Button,
	Label,
	PageHeader,
	Stack,
	VisuallyHidden,
} from "@primer/react";
import { useId } from "react";
import { plainText } from "../../core/codeSpans.js";
import { UNNAMED } from "../../core/copy.js";
import type { Activity, Entry } from "../model.js";
import { SESSION_STATUS } from "./AppContext.js";
import { failureDescription } from "./Previews.js";

export interface HeaderActions {
	readonly save: () => void;
	readonly reload: () => void;
	readonly remove: () => void;
	/** Absent for a file that cannot move: a draft, or a scheme file (named by its path). */
	readonly move?: () => void;
	/** Only for a shared file never saved: its name is not yet anyone else's. Local, so never blocked. */
	readonly rename?: () => void;
	/** Back to the bank: shown on narrow screens, where the tree and the file are separate views. */
	readonly close?: () => void;
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
	const alsoText = `Also saves ${also.join(", ")}.`;
	// Why a write cannot happen now is the session's (the top bar says it); the
	// header says only what is this file's own: which unsaved shared files a save
	// takes along. Nothing to save needs no explanation.
	const why = canWrite ? undefined : SESSION_STATUS;
	// An inactive button stays focusable and announced; its click does nothing.
	const when =
		(ok: boolean, f: () => void): (() => void) =>
		() => {
			if (ok) f();
		};
	return (
		<div className="qhead">
			<PageHeader>
				{on.close !== undefined && (
					// PageHeader shows its context area on narrow screens only.
					<PageHeader.ContextArea>
						<Button
							variant="invisible"
							size="small"
							leadingVisual={ArrowLeftIcon}
							onClick={on.close}
						>
							Back to the bank
						</Button>
					</PageHeader.ContextArea>
				)}
				<PageHeader.TitleArea variant="subtitle">
					<PageHeader.Title as="h2">
						{kind !== undefined && <span className="quiet">{kind} </span>}
						{name ?? <span className="quiet">{UNNAMED}</span>}
					</PageHeader.Title>
					<PageHeader.TrailingVisual>
						<Stack direction="horizontal" gap="condensed">
							{/* Saved and unchanged needs no mark; a draft is unsaved by definition. */}
							{q.base === undefined ? (
								<Label variant="attention">draft</Label>
							) : (
								unsaved && <Label variant="attention">unsaved</Label>
							)}
						</Stack>
					</PageHeader.TrailingVisual>
				</PageHeader.TitleArea>
				<PageHeader.Actions>
					{/*
					 * What saving takes along, beside Save and on its line, so the header
					 * never grows a row (it is the band the sidebar shares). Short and
					 * truncated here; Save's description is the whole sentence.
					 */}
					{also.length > 0 && (
						<>
							<span className="also-saves quiet" aria-hidden title={alsoText}>
								with {also.join(", ")}
							</span>
							<VisuallyHidden id={statusId}>{alsoText}</VisuallyHidden>
						</>
					)}
					{on.rename !== undefined && (
						<Button size="small" onClick={on.rename}>
							Rename…
						</Button>
					)}
					{on.move !== undefined && (
						<Button
							size="small"
							inactive={!canWrite}
							aria-disabled={!canWrite || undefined}
							aria-describedby={why}
							onClick={when(canWrite, on.move)}
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
						aria-describedby={why}
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
						aria-describedby={why ?? (also.length > 0 ? statusId : undefined)}
						loading={saving}
						loadingAnnouncement="Saving"
						onClick={when(canWrite && !nothing && !saving, on.save)}
					>
						Save
					</Button>
				</PageHeader.Actions>
			</PageHeader>
			{activity?.kind === "failed" && (
				<Banner
					variant="critical"
					title={plainText(activity.failure.message)}
					description={failureDescription(activity.failure)}
					primaryAction={stale ? reload : undefined}
				/>
			)}
			{stale && activity?.kind !== "failed" && (
				<Banner
					variant="warning"
					title="This changed on GitHub since you started."
					description="Copy your version somewhere first if you want to keep it, then reload from GitHub."
					primaryAction={reload}
				/>
			)}
		</div>
	);
}
