/**
 * Moving a bank question to another topic folder: one commit, the saved version at the
 * new path and the old path gone, like `git mv`. Only the folder changes. Why a folder
 * cannot be used is `update`'s rule (`moveProblem`), shown as the author types, as
 * Primer's validation message on the input. A native form: Enter moves.
 */
import { FileDirectoryIcon } from "@primer/octicons-react";
import { Dialog, FormControl, TextInput } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useId } from "react";
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
	const formId = useId();
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
					type: "submit",
					form: formId,
					inactive: problem !== undefined,
					"aria-disabled": problem !== undefined || undefined,
				},
			]}
		>
			<form
				id={formId}
				onSubmit={(e) => {
					e.preventDefault();
					if (problem === undefined) dispatch({ kind: "moveConfirmed" });
				}}
			>
				<FormControl>
					<FormControl.Label>Topic folder</FormControl.Label>
					<TextInput
						block
						autoFocus
						leadingVisual={FileDirectoryIcon}
						value={folder}
						{...(problem !== undefined && {
							validationStatus: "error" as const,
						})}
						onChange={(e) =>
							dispatch({ kind: "moveFolderChanged", folder: e.target.value })
						}
					/>
					<FormControl.Caption>
						<code>{from}</code> → <code>{to}</code>. The saved version moves;
						unsaved edits stay unsaved. In the bank: {folders.join(", ")}.
					</FormControl.Caption>
					{problem !== undefined && (
						<FormControl.Validation variant="error">
							{inlineCode(problem)}
						</FormControl.Validation>
					)}
				</FormControl>
			</form>
			{problem === undefined && !folders.includes(folder) && (
				<InlineMessage variant="warning">
					<b>{folder}</b> is a new topic. Moving creates it.
				</InlineMessage>
			)}
		</Dialog>
	);
}
