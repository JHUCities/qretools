/**
 * An instrument, whole: read against its banks, checked, and elaborated to DDI, as
 * `evaluate` does for a question. Total: any text gives a draft with holes, findings in
 * document order, and a DDI document.
 */
import { isMap, isScalar, parseDocument } from "yaml";
import { HERE } from "../address.ts";
import type { Collision, DdiDocument } from "../ddi/document.ts";
import { SELECT_ALL_ID } from "../ddi/elaborate.ts";
import type { BankScope } from "../evaluate.ts";
import { type Finding, inDocumentOrder, type Range } from "../findings.ts";
import { UNDECLARED_AGENCY } from "../schemes.ts";
import { DEFAULT_SELECT_ALL, selectAllText } from "../selectAll.ts";
import { AGENCY_PATTERN, AGENCY_RULE_TEXT } from "../surface/bankfile.ts";
import type { Livelit } from "../surface/livelits.ts";
import { inspectInstrument } from "./check.ts";
import type { InstrumentDraft, Use } from "./draft.ts";
import { elaborateInstrument, instrumentDocument } from "./elaborate.ts";
import { instrumentLivelits } from "./livelits.ts";
import { parseInstrument, type Unread } from "./parse.ts";
import { type InstrumentRef, instrumentRefs } from "./refs.ts";

export interface InstrumentContext {
	/** The banks it uses, each already evaluated (`bankOf`), by the alias `uses` gives it. */
	readonly banks: Readonly<Record<string, BankScope>>;
	/**
	 * Why a bank `uses` names isn't in `banks`, by alias, when the caller knows: said on
	 * its `uses` entry, or nothing while it's still being read. Absent, a bank not given
	 * is said to be missing.
	 */
	readonly unresolved?: Readonly<Record<string, Unread>>;
	/**
	 * The DDI agency the instrument is published under: its maker's, not necessarily its
	 * banks'. Absent, it is published under `invalid`, and a finding says so.
	 */
	readonly agency?: string;
	/** Its DDI version; "1" when nothing is known of its history. */
	readonly version?: string;
}

export interface Instrument {
	readonly draft: InstrumentDraft;
	/** The agency it was given, valid or not; absent when none was. */
	readonly agency?: string;
	/** The parse's and the checks' findings, in document order. */
	readonly findings: readonly Finding[];
	readonly ranges: Readonly<Record<string, Range>>;
	readonly ddi: DdiDocument;
	/** Where each DDI item came from: its DDI ID's path in the instrument (`placeFindings`). */
	readonly places: Readonly<Record<string, string>>;
	/** Identities two different items would share: an export must refuse while any exist. */
	readonly collisions: readonly Collision<string>[];
	/** Where it names its banks' files, for go to definition (`instrumentRefs`). */
	readonly refs: readonly InstrumentRef[];
	/** Its pickers (`instrumentLivelits`), including resolved, compatible fill sources. */
	readonly livelits: readonly Livelit[];
}

export function instrumentOf(
	source: string,
	context: InstrumentContext,
): Instrument {
	const parsed = parseInstrument(source, context.banks, context.unresolved);
	const checked = inspectInstrument(parsed);
	const elaborated = elaborateInstrument(parsed, {
		agency: context.agency ?? UNDECLARED_AGENCY,
		...(context.version !== undefined && { version: context.version }),
	});
	const { document, collisions } = instrumentDocument(elaborated);
	const agency: Finding[] =
		context.agency !== undefined && !AGENCY_PATTERN.test(context.agency)
			? [
					{
						code: "invalid-agency",
						severity: "error",
						path: "",
						message: `\`${context.agency}\` isn't a DDI agency.`,
						hint: AGENCY_RULE_TEXT,
					},
				]
			: context.agency === undefined
				? [
						{
							code: "hole",
							severity: "hole",
							path: "",
							message: "No DDI agency is given for this instrument.",
							hint: `Until one is, its DDI is published under \`${UNDECLARED_AGENCY}\`.`,
						},
					]
				: [];
	const clashes = clashFindings(collisions, parsed.draft.uses);
	// A bank with no agency would publish its questions under `invalid`: say so where it's
	// used. Not for the instrument's own workspace (`../`): its agency is the instrument's,
	// and the finding above already says it is missing or wrong.
	const banksWithout: Finding[] = parsed.draft.uses.flatMap((u): Finding[] =>
		u.address?.trim() !== HERE &&
		context.banks[u.alias] !== undefined &&
		context.banks[u.alias]?.agency === undefined
			? [
					{
						code: "invalid-agency",
						severity: "error",
						path: `uses.${u.alias}`,
						message: `\`${u.alias}\` declares no DDI agency, so its questions would be published under \`${UNDECLARED_AGENCY}\`.`,
						hint: "A workspace gives its agency in its `workspace.yaml`.",
					},
				]
			: [],
	);
	return {
		draft: parsed.draft,
		...(context.agency !== undefined && { agency: context.agency }),
		findings: inDocumentOrder(
			[
				...parsed.findings,
				...checked.findings,
				...clashes,
				...agency,
				...banksWithout,
			],
			parsed.ranges,
		),
		ranges: parsed.ranges,
		ddi: document,
		places: elaborated.places,
		collisions,
		refs: instrumentRefs(parsed, source),
		livelits: instrumentLivelits(source, parsed, checked.fills),
	};
}

/**
 * One finding per identity two different items would share; the codings of select all
 * that apply (a code list and its two categories) from workspaces under one agency are
 * said once, on the `uses` line written last among them.
 */
function clashFindings(
	collisions: readonly Collision<string>[],
	uses: readonly Use[],
): Finding[] {
	const generic: Finding[] = [];
	const codings = new Map<string, { agency: string; aliases: string[] }>();
	for (const c of collisions) {
		// `urn:ddi:agency:id:version`: neither an agency nor an ID holds a colon.
		const [, , agency = "", id = ""] = c.urn.split(":");
		if (!id.startsWith(`${SELECT_ALL_ID}.`)) {
			generic.push({
				code: "name-clash",
				severity: "error",
				path: "",
				message: `\`${c.urn}\` would name two different items, from ${c.keys.join(", ")}.`,
			});
			continue;
		}
		const aliases = [
			...new Set(c.keys.map((k) => k.split(":")[0] ?? k)),
		].sort();
		codings.set(`${agency} ${aliases.join(" ")}`, { agency, aliases });
	}
	const coding = [...codings.values()].map(({ agency, aliases }): Finding => {
		const last = uses.findLast((u) => aliases.includes(u.alias))?.alias;
		const names = aliases.map((a) => `\`${a}\``);
		const who =
			names.length === 2
				? `${names[0]} and ${names[1]} both`
				: `${names.slice(0, -1).join(", ")} and ${names.at(-1)} all`;
		return {
			code: "name-clash",
			severity: "error",
			path: last === undefined ? "" : `uses.${last}`,
			message: `${who} publish as \`${agency}\` but don't agree on how a select-all-that-apply option is stored.`,
			hint: `Make their \`select_all.yaml\` files agree. A workspace without one stores ${selectAllText(DEFAULT_SELECT_ALL)}.`,
		};
	});
	return [...generic, ...coding];
}

/**
 * The banks an instrument uses, read without anything else: what a resolver fetches
 * before `instrumentOf` can run. Pure; an address is never interpreted here.
 */
export function importsOf(source: string): readonly Use[] {
	const uses = parseDocument(source, { prettyErrors: false }).get("uses", true);
	if (!isMap(uses)) return [];
	return uses.items.flatMap((pair) => {
		if (!isScalar(pair.key)) return [];
		const alias = String(pair.key.value);
		const address =
			isScalar(pair.value) && typeof pair.value.value === "string"
				? pair.value.value
				: undefined;
		return [{ alias, ...(address !== undefined && { address }) }];
	});
}
