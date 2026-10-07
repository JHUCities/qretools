/**
 * Validation against the official DDI-Lifecycle 4.0 JSON Schema. Pure given the
 * schema as a value; loading the 900KB schema is the shell's job.
 *
 * Know what this does and does not check. The schema catches wrong item type
 * names, identity fields and their patterns, reference and language-string
 * shapes, and array-versus-object mistakes. It checks nothing at all inside
 * ResponseDomain (a 28-way anyOf of permissive objects), so unit tests on
 * `elaborate` carry that weight.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Finding } from "../findings.js";
import { err, ok, type Result } from "../result.js";
import type { DdiDocument } from "./document.js";

export type Validator = (document: DdiDocument) => readonly Finding[];

/** The schema validator's words are the detail; the message says what it means. */
const invalid = (message: string, detail: string): Finding => ({
	code: "ddi-invalid",
	severity: "error",
	path: "",
	message,
	detail,
});

export function makeValidator(schema: unknown): Result<Validator, Finding> {
	try {
		// Options this schema needs: its root has `properties` without `type`
		// (strictTypes), it uses date/uri formats we do not check, and its timezone
		// patterns are invalid under the regex `u` flag.
		const ajv = new Ajv2020({
			allErrors: true,
			strictTypes: false,
			validateFormats: false,
			unicodeRegExp: false,
		});
		const check = ajv.compile(schema as object);
		return ok((document) =>
			check(document)
				? []
				: (check.errors ?? []).map((e) =>
						invalid(
							`The DDI at \`${e.instancePath || "/"}\` doesn't match the official schema.`,
							e.message ?? "invalid",
						),
					),
		);
	} catch (e) {
		return err(
			invalid(
				"The DDI schema couldn't be loaded, so the export can't be checked.",
				e instanceof Error ? e.message : String(e),
			),
		);
	}
}
