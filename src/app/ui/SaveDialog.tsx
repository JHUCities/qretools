/**
 * Where a new question goes in the bank. The folder is prefilled from the name
 * and is the author's to change: git creates any missing path, so a new topic
 * should be deliberate and visible, not a side effect of a typo.
 */
import { AlertIcon, FileDirectoryIcon } from "@primer/octicons-react";
import { Dialog, FormControl, TextInput } from "@primer/react";
import { bankLocation } from "../../core/bank.js";
import type { Draft } from "../../core/surface/draft.js";
import type { Dispatch } from "../model.js";

export function SaveDialog({
	draft,
	folder,
	folders,
	taken,
	also,
	dispatch,
}: {
	readonly draft: Draft;
	readonly folder: string;
	readonly folders: readonly string[];
	readonly taken: (path: string) => boolean;
	/** Unsaved shared files saved with it, in the same commit. */
	readonly also: readonly string[];
	readonly dispatch: Dispatch;
}) {
	const where = bankLocation(draft, folder);
	const path = where.ok ? where.value.path : undefined;
	const isTaken = path !== undefined && taken(path);
	const isNew = where.ok && !folders.includes(folder);
	const close = () => dispatch({ kind: "saveCancelled" });
	return (
		<Dialog
			title="Save to the bank"
			onClose={close}
			footerButtons={[
				{ buttonType: "default", content: "Cancel", onClick: close },
				{
					buttonType: "primary",
					content: "Save",
					disabled: !where.ok || isTaken,
					onClick: () => dispatch({ kind: "saveConfirmed" }),
				},
			]}
		>
			<FormControl>
				<FormControl.Label>Topic folder</FormControl.Label>
				<TextInput
					block
					leadingVisual={FileDirectoryIcon}
					value={folder}
					aria-label="Topic folder"
					onChange={(e) =>
						dispatch({ kind: "saveFolderChanged", folder: e.target.value })
					}
				/>
				<FormControl.Caption>
					{folders.length === 0
						? "The bank has no topics yet."
						: `In the bank: ${folders.join(", ")}.`}
				</FormControl.Caption>
			</FormControl>
			<p className="save-path">
				{where.ok ? (
					<code>{path}</code>
				) : (
					<span className="fg-danger">
						<AlertIcon size={14} /> {where.error.message}
					</span>
				)}
			</p>
			{also.length > 0 && (
				<p>Also saves, in the same commit: {also.join(", ")}.</p>
			)}
			{isTaken && (
				<p className="fg-danger">
					<AlertIcon size={14} /> A question already exists there. Choose
					another topic, or open the bank's copy to change it.
				</p>
			)}
			{isNew && !isTaken && (
				<p className="fg-attention">
					<AlertIcon size={14} /> <b>{folder}</b> is a new topic. Saving creates
					it.
				</p>
			)}
		</Dialog>
	);
}
