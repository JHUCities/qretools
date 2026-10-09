/**
 * A bank added to the workspace: a new one here, its folder named before it exists (its
 * `bank.yaml` is started from the template), or one on GitHub, its address given. From an
 * instrument's `uses` entry, the address is written there once it's added. The reason it
 * can't be added is policy from `update` (`bankAddProblem`), shown as the author types.
 */

import { Dialog, FormControl, TextInput } from "@primer/react";
import { inlineCode } from "@qretools/shell/ui";
import { useId } from "react";
import type { AddingBank, Dispatch } from "../model.js";
import { newBankFolder } from "../update.js";

const EXAMPLE = { new: "households", import: "owner/bank@v1" } as const;

export function AddBankDialog({
	adding,
	problem,
	dispatch,
}: {
	readonly adding: AddingBank;
	readonly problem: string | undefined;
	readonly dispatch: Dispatch;
}) {
	const formId = useId();
	const close = () => dispatch({ kind: "bankAddCancelled" });
	const { how, text } = adding;
	// Nothing typed is not yet wrong: say nothing until something is.
	const shown = text.trim() === "" ? undefined : problem;
	return (
		<Dialog
			title={how === "new" ? "New bank" : "Use a bank from GitHub"}
			onClose={close}
			footerButtons={[
				{ buttonType: "default", content: "Cancel", onClick: close },
				{
					buttonType: "primary",
					content: how === "new" ? "Create" : "Use it",
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
					if (problem === undefined) dispatch({ kind: "bankAddConfirmed" });
				}}
			>
				<FormControl>
					<FormControl.Label>
						{how === "new" ? "Name" : "Address"}
					</FormControl.Label>
					<TextInput
						block
						autoFocus
						value={text}
						placeholder={EXAMPLE[how]}
						{...(shown !== undefined && { validationStatus: "error" as const })}
						onChange={(e) =>
							dispatch({ kind: "bankAddChanged", text: e.target.value })
						}
					/>
					<FormControl.Caption>
						{how === "new" ? (
							<>
								Its folder is{" "}
								<code className="code">
									{newBankFolder(text.trim() || EXAMPLE.new)}
								</code>
								, with its details in <code className="code">bank.yaml</code>.
							</>
						) : (
							<>
								A repository and the version to read it at, such as{" "}
								<code className="code">owner/bank@v1</code>, with the bank's
								folder if it isn't at the root (
								<code className="code">owner/repo/banks/hh@v1</code>).
							</>
						)}
					</FormControl.Caption>
					{shown !== undefined && (
						<FormControl.Validation variant="error">
							{inlineCode(shown)}
						</FormControl.Validation>
					)}
				</FormControl>
			</form>
		</Dialog>
	);
}
