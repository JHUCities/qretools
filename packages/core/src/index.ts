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
	HERE,
	notHere,
} from "./address.ts";
export {
	type BankLocation,
	bankLocation,
	FOLDER_PATTERN,
	saveableName,
} from "./bank.ts";
export { codeSpans, plainText, type Span } from "./codeSpans.ts";
export { type Compacted, compact } from "./compact.ts";
// The condition language, as instruments write it and the DDI's CommandCode holds it:
// for a program that reads conditions back out of DDI (an export to a survey platform).
export {
	type BinaryOp,
	DDI_FUNCTIONS,
	type Expr,
	holesOf,
	namesOf,
} from "./cond/ast.ts";
export { evaluateCondition, type Value } from "./cond/eval.ts";
export { parseCondition } from "./cond/parse.ts";
export { printCondition } from "./cond/print.ts";
export {
	FOLDER_RULE_TEXT,
	NAME_RULE_TEXT,
	SCHEME_LABELS,
	SCHEME_NAME,
	SCHEME_SINGULAR,
	SEVERITY_LABEL,
	toFillIn,
	UNNAMED,
	WORKSPACE_DETAILS,
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
	NOT_TICKED,
	TICKED,
	type Versioning,
} from "./ddi/elaborate.ts";
export { makeValidator, type Validator } from "./ddi/validate.ts";
export {
	type GitOrigin,
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
	type Publishing,
	questionItems,
	type SchemeFileEvaluation,
	scopeOf,
	UNDECLARED_AGENCY,
} from "./evaluate.ts";
export {
	type Edit,
	type Finding,
	type FindingCode,
	type Fix,
	inDocumentOrder,
	type LintCode,
	locate,
	type ParseCode,
	placeFindings,
	type Range,
	type Severity,
	type Status,
	status,
	type Target,
} from "./findings.ts";
export { type History, type Snapshot, versionsOf } from "./history.ts";
export {
	type Input as InstrumentInput,
	type InstrumentDraft,
	type Node as InstrumentNode,
	STOP,
	type Use as InstrumentUse,
} from "./instrument/draft.ts";
export { exampleInstrument } from "./instrument/example.ts";
export {
	type Instrument,
	type InstrumentContext,
	importsOf,
	instrumentOf,
} from "./instrument/instrument.ts";
export type { Unread } from "./instrument/parse.ts";
export {
	type InstrumentRef,
	instrumentRefAt,
	instrumentRefs,
} from "./instrument/refs.ts";
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
	bankAgency,
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
	unknownFolders,
} from "./schemes.ts";
export {
	DEFAULT_SELECT_ALL,
	type SelectAll,
	selectAllText,
} from "./selectAll.ts";
export {
	AGENCY_PATTERN,
	agencyWritten,
	type ParsedSettingsFile,
	parseSelectAllFile,
	parseSettingsFile,
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
	envAt,
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
	type InstrumentIn,
	instrumentAt,
	instrumentIn,
	instrumentPath,
	type RemoteBank,
	type Resolution,
	readsInWorkspace,
	remoteScope,
	remotesOf,
	resolveUses,
	skippedFolder,
	WORKSPACE,
	type Workspace,
	workspaceOf,
} from "./workspace.ts";
