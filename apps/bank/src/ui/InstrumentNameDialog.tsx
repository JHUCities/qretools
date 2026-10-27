/**
 * An instrument is named before it exists, as a shared file is. The name gives its file,
 * `instruments/<name>.yaml`, and its first line, `name:`. Why a name can't be used comes
 * from `update`, shown as the author types.
 */

import { Dialog, FormControl, TextInput } from "@primer/react";
import { instrumentPath } from "@qretools/core";
import { inlineCode } from "@qretools/shell/ui";
import { useId } from "react";
import type { Dispatch } from "../model.js";

const EXAMPLE = "wave1";

export function InstrumentNameDialog({
	name,
	example,
	problem,
	dispatch,
}: {
	readonly name: string;
	/** The example instrument: said in the title, and what it holds in the caption. */
	readonly example: boolean;
	readonly problem: string | undefined;
	readonly dispatch: Dispatch;
}) {
	const formId = useId();
	const close = () => dispatch({ kind: "instrumentNamingCancelled" });
	// An empty name is not yet wrong: say nothing until something is typed.
	const shown = name === "" ? undefined : problem;
	return (
		<Dialog
			title={example ? "New example instrument" : "New instrument"}
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
						{example &&
							" It asks questions from the bank, to show what an instrument looks like. Copy it or delete it."}
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
