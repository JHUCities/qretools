/**
 * Moving a bank question to another topic folder: one commit, the saved version at the
 * new path and the old path gone, like `git mv`. Only the folder changes. Why a folder
 * cannot be used is `update`'s rule (`moveProblem`), shown as the author types.
 */
import { AlertIcon, FileDirectoryIcon } from "@primer/octicons-react";
import { Dialog, FormControl, TextInput } from "@primer/react";
import type { Dispatch } from "../model.js";
import { inlineCode } from "./Previews.js";

export function MoveDialog({
	from,
	to,
	folder,
	folders,
	problem,
	dispatch,
}: {
	readonly from: string;
	readonly to: string;
	readonly folder: string;
	readonly folders: readonly string[];
	readonly problem: string | undefined;
	readonly dispatch: Dispatch;
}) {
	const close = () => dispatch({ kind: "moveCancelled" });
	return (
		<Dialog
			title="Move to another topic"
			onClose={close}
			footerButtons={[
				{ buttonType: "default", content: "Cancel", onClick: close },
				{
					buttonType: "primary",
					content: "Move",
					disabled: problem !== undefined,
					onClick: () => dispatch({ kind: "moveConfirmed" }),
				},
			]}
		>
			<FormControl>
				<FormControl.Label>Topic folder</FormControl.Label>
				<TextInput
					block
					autoFocus
					leadingVisual={FileDirectoryIcon}
					value={folder}
					aria-label="Topic folder"
					onChange={(e) =>
						dispatch({ kind: "moveFolderChanged", folder: e.target.value })
					}
				/>
				<FormControl.Caption>
					In the bank: {folders.join(", ")}. The saved version moves; unsaved
					edits stay unsaved.
				</FormControl.Caption>
			</FormControl>
			<p className="save-path">
				<code>{from}</code> → <code>{to}</code>
			</p>
			{problem !== undefined && (
				<p className="fg-danger">
					<AlertIcon size={14} /> {inlineCode(problem)}
				</p>
			)}
			{problem === undefined && !folders.includes(folder) && (
				<p className="fg-attention">
					<AlertIcon size={14} /> <b>{folder}</b> is a new topic. Moving creates
					it.
				</p>
			)}
		</Dialog>
	);
}
