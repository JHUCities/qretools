/**
 * Where a new question goes in the bank. The folder is prefilled from the name
 * and is the author's to change: git creates any missing path, so a new topic
 * should be deliberate and visible, not a side effect of a typo.
 *
 * A native form: Enter submits, the primary button is its submit button, and what is
 * wrong is Primer's validation message, tied to the input.
 */
import { FileDirectoryIcon } from "@primer/octicons-react";
import { Dialog, FormControl, TextInput } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { useId } from "react";
import { bankLocation } from "../../core/bank.js";
import type { Draft } from "../../core/surface/draft.js";
import type { Dispatch } from "../model.js";
import { inlineCode } from "./Previews.js";

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
	const formId = useId();
	const where = bankLocation(draft, folder);
	const path = where.ok ? where.value.path : undefined;
	const problem = !where.ok
		? where.error.message
		: path !== undefined && taken(path)
			? "A question already exists there. Choose another topic, or open the bank's copy to change it."
			: undefined;
	const isNew = problem === undefined && !folders.includes(folder);
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
					if (problem === undefined) dispatch({ kind: "saveConfirmed" });
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
							dispatch({ kind: "saveFolderChanged", folder: e.target.value })
						}
					/>
					<FormControl.Caption>
						{path !== undefined && <code>{path}</code>}{" "}
						{folders.length === 0
							? "The bank has no topics yet."
							: `In the bank: ${folders.join(", ")}.`}
					</FormControl.Caption>
					{problem !== undefined && (
						<FormControl.Validation variant="error">
							{inlineCode(problem)}
						</FormControl.Validation>
					)}
				</FormControl>
			</form>
			{isNew && (
				<InlineMessage variant="warning">
					<b>{folder}</b> is a new topic. Saving creates it.
				</InlineMessage>
			)}
			{also.length > 0 && (
				<InlineMessage variant="unavailable">
					Also saves, in the same commit: {also.join(", ")}.
				</InlineMessage>
			)}
		</Dialog>
	);
}
