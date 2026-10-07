/**
 * `@qretools/core`: questions and a bank's shared files written in the surface
 * language, read with holes, checked, and elaborated to DDI-Lifecycle 4.0. Pure: values
 * in, values out; findings are values, never exceptions. What an editor needs beyond
 * this is `@qretools/core/editor`; reading a bank from a directory is
 * `@qretools/core/node`.
 */

export {
	type BankLocation,
	bankLocation,
	FOLDER_PATTERN,
	saveableName,
} from "./bank.js";
export { codeSpans, plainText, type Span } from "./codeSpans.js";
export { type Compacted, compact } from "./compact.js";
export {
	FOLDER_RULE_TEXT,
	NAME_RULE_TEXT,
	SCHEME_LABELS,
	SCHEME_NAME,
	SCHEME_SINGULAR,
	toFillIn,
	UNNAMED,
} from "./copy.js";
export type {
	Collision,
	DdiDocument,
	Identity,
	Item,
	ItemType,
	Json,
	JsonObject,
} from "./ddi/document.js";
export { collisions, documentOf } from "./ddi/document.js";
export {
	elaborate,
	elaborateItems,
	type Versioning,
} from "./ddi/elaborate.js";
export { makeValidator, type Validator } from "./ddi/validate.js";
export {
	UNVERSIONED,
	type Version,
	type Versions,
} from "./ddi/version.js";
export {
	type Bank,
	bankOf,
	type Evaluation,
	evaluate,
	type SchemeFileEvaluation,
	UNDECLARED_AGENCY,
} from "./evaluate.js";
export {
	type Edit,
	type Finding,
	type FindingCode,
	type Fix,
	inDocumentOrder,
	type LintCode,
	type ParseCode,
	type Range,
	type Severity,
	type Status,
	status,
	type Target,
} from "./findings.js";
export { lint } from "./lint.js";
export {
	type CodebookView,
	codebookView,
	type Hole,
	type Input,
	type Resolved,
	type RespondentView,
	respondentView,
	type Slot,
	type TextSlot,
} from "./render.js";
export { err, ok, type Result } from "./result.js";
export {
	absentRoot,
	bankEnv,
	evaluateScheme,
	FOLDERS,
	isRoot,
	type Kind,
	kindAt,
	REQUIRED_ROOTS,
	ROOT,
	type RootKind,
	SCHEME_KINDS,
	type SchemeEvaluation,
	type SchemeFile,
	type SchemeKind,
	type SchemeValue,
	SHAPE,
	type Shape,
	schemeEnv,
	schemePath,
} from "./schemes.js";
export {
	AGENCY_PATTERN,
	type ParsedBankFile,
	parseBankFile,
} from "./surface/bankfile.js";
export {
	type Code,
	type DefinedVariable,
	type Domain,
	type Draft,
	definedVariables,
	labelOf,
	type Named,
	optionVariable,
	type Prose,
	type Ref,
	textOf,
} from "./surface/draft.js";
export {
	EMPTY_ENV,
	type Env,
	FIELD_OF,
	inScope,
	type LabelledEntry,
	type Mention,
	type NamedScheme,
	type TextEntry,
} from "./surface/env.js";
export {
	FILL_TYPES,
	type Fill,
	type FillType,
	type Piece,
	piecesOf,
	placeholders,
} from "./surface/fills.js";
export type { Mark, MarkKind } from "./surface/marks.js";
export { type Parsed, parseSurface } from "./surface/parse.js";
export { parseScale, type Scale, type Scales } from "./surface/scales.js";
export { NAME_PATTERN } from "./surface/schema.js";
export {
	type BankFinding,
	bankFindings,
	fileFindings,
	type Index,
	indexOf,
	othersOf,
	type Site,
	type Symbols,
	usedBy,
} from "./symbols.js";
