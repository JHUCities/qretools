/** The export's findings: the core's `Finding`, under the export's own codes. */
import type { Finding as CoreFinding } from "@qretools/core";

/** Reported by the Qualtrics export, at a DDI item's ID. */
export type QsfCode =
	/** DDI the export can't read: not as an instrument's elaboration writes it. */
	| "qsf-unread"
	/** Something Qualtrics can't do as the DDI says it: left out, or done another way. */
	| "qsf-inexpressible"
	/** A condition too large to write as Qualtrics logic. */
	| "qsf-too-large"
	/** How the export wrote something, for the author to know: nothing the DDI says is lost. */
	| "qsf-note";

export type Finding = CoreFinding<QsfCode>;
