/**
 * Where a new question goes in the bank: the author chooses the folder, and none is
 * chosen when the dialog opens (nothing is read into the question's name). Git
 * creates any missing path, so a new folder should be deliberate and visible, not a
 * side effect of a typo.
 *
 * A native form: Enter submits, the primary button is its submit button, and what is
 * wrong is Primer's validation message, tied to the input.
 */
import { Dialog } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import { bankLocation } from "@qretools/core/bank.js";
import type { Draft } from "@qretools/core/surface/draft.js";
import { useId } from "react";
import type { Dispatch } from "../model.js";
import { FolderField } from "./FolderField.js";

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
			? "A question already exists there. Choose another folder, or open the bank's copy to change it."
			: undefined;
	const close = () => dispatch({ kind: "saveCancelled" });
	return (
		<Dialog
			title="Save to your branch"
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
				<FolderField
					folder={folder}
					folders={folders}
					problem={problem}
					onChange={(f) => dispatch({ kind: "saveFolderChanged", folder: f })}
					caption={path !== undefined && <code className="code">{path}</code>}
				/>
			</form>
			{also.length > 0 && (
				<InlineMessage variant="unavailable">
					Also saves {also.join(", ")}.
				</InlineMessage>
			)}
		</Dialog>
	);
}
