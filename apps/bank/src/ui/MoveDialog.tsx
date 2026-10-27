/**
 * Moves a bank question to another folder. A move also saves (owner, 2026-09-29): one
 * commit writes the question as it is now in the new folder, deletes the old file, and
 * takes along the unsaved shared files it names, as Save does. The filename never
 * changes. Why a folder can't be used is `update`'s rule (`moveProblem`), shown as the
 * author types; why nothing can be saved now is `writeBlocked`. Enter in the new
 * folder's name moves (a native select doesn't submit on Enter).
 */

import { Dialog } from "@primer/react";
import { useId } from "react";
import type { Dispatch } from "../model.js";
import { FolderField } from "./FolderField.js";

export function MoveDialog({
	from,
	current,
	to,
	folder,
	folders,
	problem,
	blocked,
	also,
	dispatch,
}: {
	readonly from: string;
	/** The folder it is in now, by `update`'s reading of the path. */
	readonly current: string;
	readonly to: string;
	readonly folder: string;
	readonly folders: readonly string[];
	readonly problem: string | undefined;
	/** Why nothing can be written now (`writeBlocked`), or undefined. */
	readonly blocked: string | undefined;
	/** Unsaved shared files the move takes along (`alsoSaves`). */
	readonly also: readonly string[];
	readonly dispatch: Dispatch;
}) {
	const formId = useId();
	const close = () => dispatch({ kind: "moveCancelled" });
	const refused = problem ?? blocked;
	return (
		<Dialog
			title="Move to another folder"
			onClose={close}
			footerButtons={[
				{ buttonType: "default", content: "Cancel", onClick: close },
				{
					buttonType: "primary",
					content: "Move",
					type: "submit",
					form: formId,
					inactive: refused !== undefined,
					"aria-disabled": refused !== undefined || undefined,
				},
			]}
		>
			<form
				id={formId}
				onSubmit={(e) => {
					e.preventDefault();
					if (refused === undefined) dispatch({ kind: "moveConfirmed" });
				}}
			>
				<FolderField
					folder={folder}
					folders={folders}
					current={current}
					problem={problem}
					onChange={(f) => dispatch({ kind: "moveFolderChanged", folder: f })}
					caption={
						<>
							{folder !== current && folder !== "" && (
								<>
									<code className="code">{from}</code> →{" "}
									<code className="code">{to}</code>.
								</>
							)}
							{also.length > 0 && ` Also saves ${also.join(", ")}.`}
						</>
					}
				/>
			</form>
		</Dialog>
	);
}
