/**
 * `@qretools/core`: questions and a bank's shared files written in the surface
 * language, read with holes, checked, and elaborated to DDI-Lifecycle 4.0. Pure: values
 * in, values out; findings are values, never exceptions. What an editor needs beyond
 * this is `@qretools/core/editor`; reading a bank from a directory is
 * `@qretools/core/node`.
 */

export {
	type Address,
	type AddressKey,
	addressOf,
	joinFolder,
} from "./address.ts";
export {
	type BankLocation,
	bankLocation,
	FOLDER_PATTERN,
	saveableName,
} from "./bank.ts";
export { codeSpans, plainText, type Span } from "./codeSpans.ts";
export { type Compacted, compact } from "./compact.ts";
export {
	FOLDER_RULE_TEXT,
	NAME_RULE_TEXT,
	SCHEME_LABELS,
	SCHEME_NAME,
	SCHEME_SINGULAR,
	toFillIn,
	UNNAMED,
} from "./copy.ts";
export type {
	Collision,
	DdiDocument,
	Identity,
	Item,
	ItemType,
	Json,
	JsonObject,
} from "./ddi/document.ts";
export { collisions, documentOf } from "./ddi/document.ts";
export {
	elaborate,
	elaborateItems,
	type Versioning,
} from "./ddi/elaborate.ts";
export { makeValidator, type Validator } from "./ddi/validate.ts";
export {
	UNVERSIONED,
	type Version,
	type Versions,
} from "./ddi/version.ts";
export {
	type Bank,
	type BankScope,
	bankFrom,
	bankOf,
	type Evaluation,
	evaluate,
	type SchemeFileEvaluation,
	UNDECLARED_AGENCY,
} from "./evaluate.ts";
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
} from "./findings.ts";
export type {
	Input as InstrumentInput,
	InstrumentDraft,
	Node as InstrumentNode,
	Use as InstrumentUse,
} from "./instrument/draft.ts";
export {
	type Instrument,
	type InstrumentContext,
	importsOf,
	instrumentOf,
} from "./instrument/instrument.ts";
export type { Unread } from "./instrument/parse.ts";
export { lint } from "./lint.ts";
export {
	type Exportable,
	exportRefusal,
	type Refusal,
	refusalReason,
} from "./refusal.ts";
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
} from "./render.ts";
export { err, ok, type Result } from "./result.ts";
export {
	absentRoot,
	type BankFile,
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
} from "./schemes.ts";
export {
	AGENCY_PATTERN,
	type ParsedBankFile,
	parseBankFile,
} from "./surface/bankfile.ts";
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
} from "./surface/draft.ts";
export {
	EMPTY_ENV,
	type Env,
	FIELD_OF,
	inScope,
	type LabelledEntry,
	type Mention,
	type NamedScheme,
	type TextEntry,
} from "./surface/env.ts";
export {
	FILL_TYPES,
	type Fill,
	type FillType,
	type Piece,
	piecesOf,
	placeholders,
} from "./surface/fills.ts";
export type { Mark, MarkKind } from "./surface/marks.ts";
export { type Parsed, parseSurface } from "./surface/parse.ts";
export { parseScale, type Scale, type Scales } from "./surface/scales.ts";
export { NAME_PATTERN } from "./surface/schema.ts";
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
} from "./symbols.ts";
export {
	bankAt,
	banksIn,
	type InstrumentIn,
	inBank,
	instrumentIn,
	placeOf,
	type RemoteBank,
	type Resolution,
	readsInWorkspace,
	relIn,
	remotesOf,
	resolveUses,
	skippedFolder,
	type Workspace,
	workspaceOf,
} from "./workspace.ts";
export {
	WORKSPACE,
	type WorkspaceFile,
	workspaceFileOf,
} from "./workspacefile.ts";
