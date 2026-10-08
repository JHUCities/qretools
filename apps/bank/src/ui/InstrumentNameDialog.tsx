/**
 * An instrument is named before it exists, as a shared file is: the name is its file's,
 * `instruments/<name>.yaml`, and the line its own `name:` starts with. The reason a name
 * can't be used is policy from `update`, shown as the author types.
 */

import { Dialog, FormControl, TextInput } from "@primer/react";
import { instrumentPath } from "@qretools/core";
import { inlineCode } from "@qretools/shell/ui";
import { useId } from "react";
import type { Dispatch } from "../model.js";

const EXAMPLE = "wave1";

export function InstrumentNameDialog({
	name,
	problem,
	dispatch,
}: {
	readonly name: string;
	readonly problem: string | undefined;
	readonly dispatch: Dispatch;
}) {
	const formId = useId();
	const close = () => dispatch({ kind: "instrumentNamingCancelled" });
	// An empty name is not yet wrong: say nothing until something is typed.
	const shown = name === "" ? undefined : problem;
	return (
		<Dialog
			title="New instrument"
			onClose={close}
			footerButtons={[
				{ buttonType: "default", content: "Cancel", onClick: close },
				{
					buttonType: "primary",
					content: "Create",
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
					if (problem === undefined)
						dispatch({ kind: "instrumentNamingConfirmed" });
				}}
			>
				<FormControl>
					<FormControl.Label>Name</FormControl.Label>
					<TextInput
						block
						autoFocus
						value={name}
						placeholder={EXAMPLE}
						{...(shown !== undefined && { validationStatus: "error" as const })}
						onChange={(e) =>
							dispatch({ kind: "instrumentNameChanged", name: e.target.value })
						}
					/>
					<FormControl.Caption>
						It's saved as{" "}
						<code className="code">{instrumentPath(name || EXAMPLE)}</code>.
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
