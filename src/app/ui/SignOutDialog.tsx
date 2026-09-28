/**
 * Signing out with unsaved work, which lives only in this tab: save it to the author's
 * branch first, discard it, or stay. What is saved, what is discarded and what blocks
 * the save are `update`'s (`signOutPlan`); this only says them. A failed save comes back
 * here, as Primer's Banner inside the dialog.
 */
import { Banner, Dialog } from "@primer/react";
import { plainText } from "../../core/codeSpans.js";
import type { Dispatch } from "../model.js";
import type { Failure } from "../storage.js";
import { failureDescription } from "./Previews.js";

const plural = (n: number, noun: string): string =>
	`${n} ${noun}${n === 1 ? "" : "s"}`;

export function SignOutDialog({
	questions,
	shared,
	discard,
	blocked,
	saving,
	failure,
	reason,
	dispatch,
}: {
	/** How many saved questions with unsaved changes the save takes. */
	readonly questions: number;
	/** How many shared scales, universes, instructions or missing values it takes. */
	readonly shared: number;
	/** The drafts that can't be saved without a folder, by name. */
	readonly discard: readonly string[];
	/** What changed on GitHub since it was started, by name: reload these first. */
	readonly blocked: readonly string[];
	readonly saving: boolean;
	readonly failure: Failure | undefined;
	/** Why nothing can be saved now (`writeBlocked`), if so. */
	readonly reason: string | undefined;
	readonly dispatch: Dispatch;
}) {
	const saveable = questions + shared > 0;
	const close = () => {
		if (!saving) dispatch({ kind: "signOutCancelled" });
	};
	const what = [
		questions > 0 ? plural(questions, "question") : undefined,
		shared > 0 ? plural(shared, "shared item") : undefined,
	]
		.filter((x) => x !== undefined)
		.join(" and ");
	const cannotSave =
		blocked.length > 0 || (reason !== undefined && !saving) || !saveable;
	return (
		<Dialog
			title="You have unsaved work"
			onClose={close}
			footerButtons={[
				{
					buttonType: "default",
					content: "Cancel",
					onClick: close,
					disabled: saving,
				},
				{
					buttonType: "danger",
					content: "Discard and sign out",
					onClick: () => dispatch({ kind: "signOutDiscardConfirmed" }),
					disabled: saving,
				},
				...(saveable
					? [
							{
								buttonType: "primary" as const,
								content: "Save to your branch and sign out",
								onClick: () => {
									if (!cannotSave) dispatch({ kind: "signOutSaveConfirmed" });
								},
								inactive: cannotSave,
								"aria-disabled": cannotSave || undefined,
								loading: saving,
							},
						]
					: []),
			]}
		>
			{failure !== undefined && (
				<Banner
					variant="critical"
					title={plainText(failure.message)}
					description={failureDescription(failure)}
				/>
			)}
			<p>
				It's kept only in this tab, and signing out leaves it behind.
				{saveable && ` Saving puts ${what} on your branch.`}
			</p>
			{discard.length > 0 && (
				<p>
					{discard.length === 1 ? "A draft" : plural(discard.length, "draft")}{" "}
					can't be saved without choosing a folder, so{" "}
					{discard.length === 1 ? "it's" : "they're"} discarded either way:{" "}
					{discard.join(", ")}. Cancel to save{" "}
					{discard.length === 1 ? "it" : "them"} first.
				</p>
			)}
			{blocked.length > 0 && (
				<p className="fg-attention">
					{blocked.length === 1 ? "This" : "These"} changed on GitHub since you
					started; reload {blocked.length === 1 ? "it" : "them"} first:{" "}
					{blocked.join(", ")}.
				</p>
			)}
			{reason !== undefined && !saving && blocked.length === 0 && saveable && (
				<p className="fg-attention">{reason}</p>
			)}
		</Dialog>
	);
}
