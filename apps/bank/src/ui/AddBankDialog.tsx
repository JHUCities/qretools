/**
 * A bank on GitHub for an instrument's `uses` entry: its address given, and written
 * there once it's added. The reason it can't be added is policy from `update`
 * (`bankAddProblem`), shown as the author types.
 */

import { Dialog, FormControl, TextInput } from "@primer/react";
import { inlineCode } from "@qretools/shell/ui";
import { useId } from "react";
import type { AddingBank, Dispatch } from "../model.js";

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
	const { text } = adding;
	// Nothing typed is not yet wrong: say nothing until something is.
	const shown = text.trim() === "" ? undefined : problem;
	return (
		<Dialog
			title="Use a bank from GitHub"
			onClose={close}
			footerButtons={[
				{ buttonType: "default", content: "Cancel", onClick: close },
				{
					buttonType: "primary",
					content: "Use it",
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
					<FormControl.Label>Address</FormControl.Label>
					<TextInput
						block
						autoFocus
						value={text}
						placeholder="owner/repo@v1"
						{...(shown !== undefined && { validationStatus: "error" as const })}
						onChange={(e) =>
							dispatch({ kind: "bankAddChanged", text: e.target.value })
						}
					/>
					<FormControl.Caption>
						A repository and the version to read it at, such as{" "}
						<code className="code">owner/repo@v1</code>, with the workspace's
						folder if it isn't at the root (
						<code className="code">owner/repo/surveys/hh@v1</code>).
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
