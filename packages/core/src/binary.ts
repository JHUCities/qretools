/**
 * The binary scale every select-all option's variable is coded on (0 No, 1 Yes), as the
 * Baltimore Area Survey publishes such items. One definition: the elaborator codes on
 * it, and a bank's own `scales/yesno01.yaml` is checked against it, since both are
 * published under one identity and must say the same.
 */
import type { Code } from "./surface/draft.js";

export const BINARY_SCALE = "yesno01";

export const BINARY: readonly Code[] = [
	{ code: "0", label: "No" },
	{ code: "1", label: "Yes" },
];
