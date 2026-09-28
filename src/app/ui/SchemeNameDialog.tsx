/**
 * A scheme file is named before it exists: the name is its filename and the word
 * questions write to use it, so it is chosen deliberately, once. The reason a name
 * cannot be used is policy from `update`, shown as the author types.
 */
import { Dialog, FormControl, TextInput } from "@primer/react";
import { useId } from "react";
import { SCHEME_NAME } from "../../core/copy.js";
import { schemePath } from "../../core/schemes.js";
import type { NamedScheme } from "../../core/surface/env.js";
import type { Dispatch } from "../model.js";
import { inlineCode } from "./Previews.js";

const EXAMPLES: Readonly<Record<NamedScheme, string>> = {
	scale: "satisfied5",
	universe: "owners",
	instruction: "select_one",
};

export function SchemeNameDialog({
	kind,
	name,
	problem,
	dispatch,
}: {
	readonly kind: NamedScheme;
	readonly name: string;
	readonly problem: string | undefined;
	readonly dispatch: Dispatch;
}) {
	const formId = useId();
	const close = () => dispatch({ kind: "schemeCreateCancelled" });
	// An empty name is not yet wrong: say nothing until something is typed.
	const shown = name === "" ? undefined : problem;
	return (
		<Dialog
			title={`New ${SCHEME_NAME[kind]}`}
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
						dispatch({ kind: "schemeCreateConfirmed" });
				}}
			>
				<FormControl>
					<FormControl.Label>Name</FormControl.Label>
					<TextInput
						block
						autoFocus
						value={name}
						placeholder={EXAMPLES[kind]}
						{...(shown !== undefined && { validationStatus: "error" as const })}
						onChange={(e) =>
							dispatch({ kind: "schemeNameChanged", name: e.target.value })
						}
					/>
					<FormControl.Caption>
						Questions use it by writing{" "}
						<code className="code">
							{kind === "scale" ? "responses" : kind}: {name || EXAMPLES[kind]}
						</code>
						{problem === undefined && (
							<>
								; it's saved as{" "}
								<code className="code">{schemePath(kind, name)}</code>
							</>
						)}
						.
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
