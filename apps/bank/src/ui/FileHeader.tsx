/** The open file's header: identity, state, and the actions on it. */

import { ArrowLeftIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";
import {
	Banner,
	Button,
	Label,
	PageHeader,
	Stack,
	Tooltip,
	Truncate,
	VisuallyHidden,
} from "@primer/react";
import { plainText, UNNAMED } from "@qretools/core";
import { failureDescription } from "@qretools/shell/ui";
import { type ReactElement, type ReactNode, useId } from "react";
import type { Activity, Entry } from "../model.js";
import { SESSION_STATUS, useBlocked } from "./AppContext.js";

export interface HeaderActions {
	readonly save: () => void;
	readonly reload: () => void;
	readonly remove: () => void;
	/** Absent for a file that can't move: a draft, or a scheme file (its path is its name). */
	readonly move?: () => void;
	/** Only for a shared file never saved: no one else uses its name yet. Local, so never blocked. */
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
	hint,
	on,
}: {
	q: Entry;
	activity: Activity | undefined;
	name: string | undefined;
	/** What the file is, when it isn't a question: "scale", "universe", … */
	kind?: string;
	unsaved: boolean;
	/** Why nothing can be written now (`writeBlocked`), or undefined. */
	blocked: string | undefined;
	/** Unsaved shared files this save takes along (`alsoSaves`). */
	also?: readonly string[];
	/**
	 * GitHub changed or deleted this file since the author started. "Reload from GitHub"
	 * follows the file's own state, never which file a refused save reported on.
	 */
	stale?: boolean;
	/** Something offered about this file, after its own banners: in the header's row. */
	hint?: ReactNode;
	on: HeaderActions;
}) {
	const canWrite = blocked === undefined;
	const statusId = useId();
	const reload = (
		<Banner.PrimaryAction leadingVisual={SyncIcon} onClick={on.reload}>
			Reload from GitHub
		</Banner.PrimaryAction>
	);
	const saving = activity?.kind === "saving" || activity?.kind === "waiting";
	const nothing = !unsaved && also.length === 0;
	const alsoText = `Also saves ${also.join(", ")}.`;
	// Why nothing can be saved now belongs to the session; the top bar says it in full.
	// A lasting reason is the button's tooltip, and a press opens its notice. A brief one
	// (loading, saving) passes by itself, so the button just points at the top bar's line.
	// The header itself only says which unsaved shared files a save takes along.
	const { standing, tried } = useBlocked();
	const why = canWrite || standing ? undefined : SESSION_STATUS;
	/** An inactive button, with its standing reason as a tooltip (Primer's, a description). */
	const explained = (inactive: boolean, button: ReactElement): ReactElement =>
		inactive && standing && blocked !== undefined ? (
			<Tooltip text={blocked} type="description">
				{button}
			</Tooltip>
		) : (
			button
		);
	// An inactive button stays focusable and announced. Pressed, a blocked one asks for
	// its reason; one with nothing to do does nothing.
	const when =
		(ok: boolean, f: () => void, blockedNow = !canWrite): (() => void) =>
		() => {
			if (ok) f();
			else if (blockedNow) tried();
		};
	const cantRemove = q.base !== undefined && !canWrite;
	const cantSave = !canWrite && !nothing;
	return (
		<div className="qhead">
			<PageHeader>
				{on.close !== undefined && (
					// PageHeader shows its context area on narrow screens only.
					<PageHeader.ContextArea>
						<Button
							className="back"
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
							{/* The width is a design decision (a scale's name and a count). */}
							<Truncate
								as="span"
								inline
								className="also-saves quiet"
								aria-hidden
								title={alsoText}
								maxWidth="16rem"
							>
								with {also.join(", ")}
							</Truncate>
							<VisuallyHidden id={statusId}>{alsoText}</VisuallyHidden>
						</>
					)}
					{on.rename !== undefined && (
						<Button size="small" onClick={on.rename}>
							Rename…
						</Button>
					)}
					{on.move !== undefined &&
						explained(
							!canWrite,
							<Button
								size="small"
								inactive={!canWrite}
								aria-disabled={!canWrite || undefined}
								aria-describedby={why}
								onClick={when(canWrite, on.move)}
							>
								Move…
							</Button>,
						)}
					{explained(
						cantRemove,
						<Button
							size="small"
							variant="danger"
							leadingVisual={TrashIcon}
							inactive={cantRemove}
							aria-disabled={cantRemove || undefined}
							aria-describedby={cantRemove ? why : undefined}
							loading={activity?.kind === "deleting"}
							loadingAnnouncement="Deleting"
							onClick={when(!cantRemove, on.remove, cantRemove)}
						>
							Delete…
						</Button>,
					)}
					{explained(
						cantSave,
						<Button
							size="small"
							variant="primary"
							inactive={!canWrite || nothing}
							aria-disabled={!canWrite || nothing || undefined}
							aria-describedby={why ?? (also.length > 0 ? statusId : undefined)}
							loading={saving}
							loadingAnnouncement="Saving"
							onClick={when(canWrite && !nothing && !saving, on.save, cantSave)}
						>
							Save
						</Button>,
					)}
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
					title="This was changed or deleted on GitHub since you started."
					description="To keep your changes, copy them somewhere first. Then reload from GitHub."
					primaryAction={reload}
				/>
			)}
			{hint}
		</div>
	);
}
