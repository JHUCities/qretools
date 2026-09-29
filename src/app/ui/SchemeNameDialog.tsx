/**
 * A shared file is named before it exists: the name is its filename and the word
 * questions write to use it. A universe or instruction is also given its wording here,
 * so one dialog makes it whole and the question that asked for it can use it at once.
 * A draft (never saved) can be renamed with the same dialog. The reason a name cannot be
 * used is policy from `update`, shown as the author types.
 */
import { Dialog, FormControl, Stack, Textarea, TextInput } from "@primer/react";
import { useId } from "react";
import { SCHEME_NAME } from "../../core/copy.js";
import { schemePath } from "../../core/schemes.js";
import type { NamedScheme } from "../../core/surface/env.js";
import type { Dispatch, Naming } from "../model.js";
import { inlineCode } from "./Previews.js";

const EXAMPLES: Readonly<Record<NamedScheme, string>> = {
	scale: "satisfied5",
	universe: "owners",
	instruction: "select_one",
};

const FIELD: Readonly<Record<NamedScheme, string>> = {
	scale: "responses",
	universe: "universe",
	instruction: "instruction",
};

export function SchemeNameDialog({
	naming,
	problem,
	dispatch,
}: {
	readonly naming: Naming;
	readonly problem: string | undefined;
	readonly dispatch: Dispatch;
}) {
	const formId = useId();
	const { kind, name, text, purpose } = naming;
	const renaming = purpose.kind === "rename";
	const close = () => dispatch({ kind: "schemeNamingCancelled" });
	// An empty name is not yet wrong: say nothing until something is typed.
	const shown = name === "" ? undefined : problem;
	const withText = !renaming && kind !== "scale";
	return (
		<Dialog
			title={`${renaming ? "Rename" : "New"} ${SCHEME_NAME[kind]}`}
			onClose={close}
			footerButtons={[
				{ buttonType: "default", content: "Cancel", onClick: close },
				{
					buttonType: "primary",
					content: renaming ? "Rename" : "Create",
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
						dispatch({ kind: "schemeNamingConfirmed" });
				}}
			>
				<Stack gap="normal">
					<FormControl>
						<FormControl.Label>Name</FormControl.Label>
						<TextInput
							block
							autoFocus
							// Prefilled from what the question wrote: selected, so typing replaces it.
							onFocus={(e) => e.currentTarget.select()}
							value={name}
							placeholder={EXAMPLES[kind]}
							{...(shown !== undefined && {
								validationStatus: "error" as const,
							})}
							onChange={(e) =>
								dispatch({ kind: "schemeNameChanged", name: e.target.value })
							}
						/>
						<FormControl.Caption>
							Questions use it by writing{" "}
							<code className="code">
								{FIELD[kind]}: {name || EXAMPLES[kind]}
							</code>
							{problem === undefined && (
								<>
									; it's saved as{" "}
									<code className="code">{schemePath(kind, name)}</code>
								</>
							)}
							.
							{purpose.kind === "create" &&
								purpose.use !== undefined &&
								" The question you came from will use it."}
							{renaming &&
								" Questions in this tab that use the old name follow."}
						</FormControl.Caption>
						{shown !== undefined && (
							<FormControl.Validation variant="error">
								{inlineCode(shown)}
							</FormControl.Validation>
						)}
					</FormControl>
					{withText && (
						<FormControl>
							<FormControl.Label>Text</FormControl.Label>
							<Textarea
								block
								rows={2}
								resize="vertical"
								value={text}
								placeholder={
									kind === "universe" ? "Owners only" : "Select all that apply"
								}
								onChange={(e) =>
									dispatch({ kind: "schemeTextChanged", text: e.target.value })
								}
							/>
							<FormControl.Caption>
								The wording, as respondents or interviewers read it. You can
								also write it later.
							</FormControl.Caption>
						</FormControl>
					)}
				</Stack>
			</form>
		</Dialog>
	);
}
