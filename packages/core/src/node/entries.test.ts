import * as core from "@qretools/core";
import * as editor from "@qretools/core/editor";
import * as node from "@qretools/core/node";
import { describe, expect, it } from "vitest";

/** The public surface, so any change to it shows up in review. Here, beside the Node entry, because it imports it. */
describe("the entry points", () => {
	it("export these values", () => {
		expect({
			core: Object.keys(core).sort(),
			editor: Object.keys(editor).sort(),
			node: Object.keys(node).sort(),
		}).toMatchInlineSnapshot(`
			{
			  "core": [
			    "EMPTY_ENV",
			    "FIELD_OF",
			    "FOLDERS",
			    "FOLDER_PATTERN",
			    "FOLDER_RULE_TEXT",
			    "MISSING_NAME",
			    "NAME_PATTERN",
			    "NAME_RULE_TEXT",
			    "SCHEME_KINDS",
			    "SCHEME_LABELS",
			    "SCHEME_NAME",
			    "SCHEME_SINGULAR",
			    "SHAPE",
			    "UNNAMED",
			    "bankEnv",
			    "bankFindings",
			    "bankLocation",
			    "bankOf",
			    "codeSpans",
			    "codebookView",
			    "compact",
			    "definedVariables",
			    "documentOf",
			    "elaborate",
			    "elaborateItems",
			    "err",
			    "evaluate",
			    "evaluateScheme",
			    "fileFindings",
			    "inDocumentOrder",
			    "inScope",
			    "indexOf",
			    "kindAt",
			    "labelOf",
			    "lint",
			    "makeValidator",
			    "ok",
			    "optionVariable",
			    "othersOf",
			    "parseScale",
			    "parseSurface",
			    "plainText",
			    "respondentView",
			    "saveableName",
			    "schemeEnv",
			    "schemePath",
			    "status",
			    "textOf",
			    "toFillIn",
			    "usedBy",
			  ],
			  "editor": [
			    "addSpace",
			    "applyEdits",
			    "inspect",
			    "labelledJsonSchema",
			    "labelledSource",
			    "labelsJsonSchema",
			    "locate",
			    "marksOf",
			    "mentionAt",
			    "nameFrom",
			    "pathAt",
			    "placeAt",
			    "questionJsonSchema",
			    "rangesOf",
			    "renameEdits",
			    "spaceBefore",
			    "textEntryJsonSchema",
			    "textEntrySource",
			  ],
			  "node": [
			    "readBank",
			  ],
			}
		`);
	});
});
