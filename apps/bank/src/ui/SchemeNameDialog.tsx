/**
 * A shared file is named before it exists. The name is its filename and the word
 * questions write to use it. A universe or instruction also gets its wording here, so
 * the question that asked for it can use it at once. The same dialog renames a draft
 * (never saved). Why a name can't be used comes from `update`, shown as the author types.
 */

import { Dialog, FormControl, Stack, Textarea, TextInput } from "@primer/react";
import {
	FIELD_OF,
	type NamedScheme,
	SCHEME_NAME,
	SCHEME_SINGULAR,
	SHAPE,
	schemePath,
} from "@qretools/core";
import { inlineCode } from "@qretools/shell/ui";
import { useId } from "react";
import type { Dispatch, Naming } from "../model.js";

const EXAMPLES: Readonly<Record<NamedScheme, string>> = {
	concept: "neighborhood_satisfaction",
	scale: "satisfied5",
	unit: "days",
	universe: "owners",
	instruction: "select_one",
};

const PLACEHOLDER: Readonly<Record<NamedScheme, string>> = {
	concept: "Neighborhood satisfaction",
	scale: "",
	unit: "days",
	universe: "Owners only",
	instruction: "Select all that apply",
};

/** The field a question writes it in (a unit's sits inside `number:`). */
const field = (kind: NamedScheme): string =>
	FIELD_OF[kind].split(".").at(-1) ?? FIELD_OF[kind];

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
	const shape = SHAPE[kind];
	const withText = !renaming && shape !== "labels";
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
								{field(kind)}: {name || EXAMPLES[kind]}
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
								" Questions in this tab that use the old name are updated too."}
						</FormControl.Caption>
						{shown !== undefined && (
							<FormControl.Validation variant="error">
								{inlineCode(shown)}
							</FormControl.Validation>
						)}
					</FormControl>
					{withText && (
						<FormControl>
							<FormControl.Label>
								{shape === "labelled" ? "Label" : "Text"}
							</FormControl.Label>
							<Textarea
								block
								rows={2}
								resize="vertical"
								value={text}
								placeholder={PLACEHOLDER[kind]}
								onChange={(e) =>
									dispatch({ kind: "schemeTextChanged", text: e.target.value })
								}
							/>
							<FormControl.Caption>
								{shape === "labelled"
									? `The ${SCHEME_SINGULAR[kind]} in a few words. You can add a definition later.`
									: "The words respondents or interviewers read. You can also write them later."}
							</FormControl.Caption>
						</FormControl>
					)}
				</Stack>
			</form>
		</Dialog>
	);
}
