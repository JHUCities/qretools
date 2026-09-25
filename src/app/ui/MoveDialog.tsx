/**
 * Moving a bank question to another topic folder: one commit, the saved version at the
 * new path and the old path gone, like `git mv`. Only the folder changes. Why a folder
 * cannot be used is `update`'s rule (`moveProblem`), shown as the author types, as
 * Primer's validation message on the field. A native form: Enter in the new topic's
 * name moves (a native select does not submit on Enter).
 */
import { Dialog } from "@primer/react";
import { useId } from "react";
import type { Dispatch } from "../model.js";
import { TopicField } from "./TopicField.js";

export function MoveDialog({
	from,
	current,
	to,
	folder,
	folders,
	problem,
	dispatch,
}: {
	readonly from: string;
	/** The topic it is in now, by `update`'s reading of the path. */
	readonly current: string;
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
				<TopicField
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
									<code className="code">{to}</code>.{" "}
								</>
							)}
							The saved version moves; unsaved edits stay unsaved.
						</>
					}
				/>
			</form>
		</Dialog>
	);
}
