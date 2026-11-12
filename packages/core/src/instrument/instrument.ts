/**
 * An instrument, whole: read against its banks, checked, and elaborated to DDI, as
 * `evaluate` does for a question. Total: any text gives a draft with holes, findings in
 * document order, and a DDI document.
 */
import { isMap, isScalar, parseDocument } from "yaml";
import { HERE } from "../address.ts";
import type { Collision, DdiDocument } from "../ddi/document.ts";
import { SELECT_ALL_ID } from "../ddi/elaborate.ts";
import type { Version } from "../ddi/version.ts";
import type { BankScope } from "../evaluate.ts";
import { type Finding, inDocumentOrder, type Range } from "../findings.ts";
import { ACCESS_REFUSING } from "../refusal.ts";
import { UNDECLARED_AGENCY } from "../schemes.ts";
import { DEFAULT_SELECT_ALL, selectAllText } from "../selectAll.ts";
import { AGENCY_PATTERN, AGENCY_RULE_TEXT } from "../surface/bankfile.ts";
import type { Env } from "../surface/env.ts";
import type { Livelit } from "../surface/livelits.ts";
import { inspectInstrument } from "./check.ts";
import { type InstrumentDraft, steps, type Use } from "./draft.ts";
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
	 * banks'. Absent, its DDI shows `invalid` in its place and can't be exported, and a
	 * finding says so.
	 */
	readonly agency?: string;
	/** Its DDI version; "1" when nothing is known of its history. */
	readonly version?: string;
	/**
	 * Its own workspace's settings, which an imported question is checked against: its
	 * access levels must cover the levels asked at, and its missing values and select-all
	 * coding are compared with each bank's. Its inputs take its missing values. Absent
	 * when it's in no workspace: then nothing is checked, and inputs take none.
	 */
	readonly host?: Host;
}

/** What of its own workspace an instrument reads (`InstrumentContext.host`). */
export interface Host extends Pick<Env, "access" | "missing" | "selectAll"> {
	/** `missing.yaml`'s DDI version, when the workspace's history is known. */
	readonly missingVersion?: Version;
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
		...(context.host !== undefined && {
			missing: {
				codes: context.host.missing,
				...(context.host.missingVersion !== undefined && {
					version: context.host.missingVersion,
				}),
			},
		}),
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
							message: "This instrument has no DDI agency yet.",
							hint: "Add an `agency:` line to `workspace.yaml`. Until then the DDI can't be exported.",
						},
					]
				: [];
	const clashes = clashFindings(collisions, parsed.draft.uses);
	// A bank with no agency stops the instrument's export: say so where it's
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
						message: `\`${u.alias}\` has no DDI agency, so this instrument's DDI can't be exported.`,
						hint: `Add an \`agency:\` line to the \`workspace.yaml\` of \`${u.alias}\`.`,
					},
				]
			: [],
	);
	// An asked question whose access level its bank can't say stops the export too
	// (`ACCESS_REFUSING`): said once per bank, at its use, naming the first such question.
	const unmarked = new Map<string, Finding>();
	for (const node of steps(parsed.draft.flow)) {
		const q = node.kind === "ask" ? node.question : undefined;
		const f = q?.evaluation.findings.find((f) =>
			ACCESS_REFUSING.includes(f.code),
		);
		if (q === undefined || f === undefined || unmarked.has(q.alias)) continue;
		unmarked.set(q.alias, {
			code: f.code,
			severity: "error",
			path: `uses.${q.alias}`,
			message: `\`${q.alias}.${q.name}\`: ${f.message}`,
			hint: `Correct the \`access\` list in the \`workspace.yaml\` of \`${q.alias}\`.`,
		});
	}
	// An asked question keeps its home bank's policy; its workspace must declare each
	// level it asks at, in the same order, so its own policy covers what it publishes.
	const host = context.host;
	// shortcut: an ask the text can't place is said on its bank's `uses` line; unreachable
	// through `parseInstrument` today, so untested: test it if a draft can lack an ask's range.
	const placed = (alias: string, path: string) =>
		parsed.ranges[path] === undefined ? `uses.${alias}` : path;
	const undeclared =
		host === undefined
			? []
			: [...asksByBank(parsed.draft)].flatMap(([alias, asks]) =>
					hostCovers(
						host.access,
						alias,
						context.banks[alias]?.env.access,
						asks.map((a) => ({ ...a, path: placed(alias, a.path) })),
					),
				);
	// Its missing values and select-all coding: an imported question keeps its bank's in
	// the DDI, which is right; the workspace is told where they differ from its own.
	const conventions: Finding[] =
		host === undefined
			? []
			: [...steps(parsed.draft.flow)].flatMap((node) => {
					const q = node.kind === "ask" ? node.question : undefined;
					const env = q === undefined ? undefined : context.banks[q.alias]?.env;
					if (q === undefined || env === undefined) return [];
					return conventionFindings(host, env, {
						path: placed(q.alias, `${node.path}.ask`),
						question: `${q.alias}.${q.name}`,
						selectAll:
							q.evaluation.draft.domain?.kind === "responses" &&
							q.evaluation.draft.domain.select === "many",
					});
				});
	// A release whose manifest can't be used: its questions are published, at version 1.
	const staleManifests: Finding[] = parsed.draft.uses.flatMap(
		(u): Finding[] => {
			const m = context.banks[u.alias]?.manifest;
			return m === undefined
				? []
				: [
						{
							code: "manifest",
							severity: "warning",
							path: `uses.${u.alias}`,
							message: `QREtools can't read the version list in the \`${u.alias}\` release. ${m.reason}`,
							hint: `Until it can, every \`${u.alias}\` question is version 1.`,
						},
					];
		},
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
				...unmarked.values(),
				...undeclared,
				...conventions,
				...staleManifests,
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

/** One place an instrument asks a bank question at a level. */
interface Ask {
	/** Where it's asked: the `ask` field of its step. */
	readonly path: string;
	/** As written: `alias.name`. */
	readonly question: string;
	/** As held: a missing or unreadable level is the bank's last. */
	readonly level: string;
	/** The level is held, not written: the question's own `access` line is missing or unreadable. */
	readonly held: boolean;
}

/** Every ask of a question with a level, anywhere in the flow, by its bank's alias. */
function asksByBank(
	draft: InstrumentDraft,
): ReadonlyMap<string, readonly Ask[]> {
	const asks = new Map<string, Ask[]>();
	for (const node of steps(draft.flow)) {
		const q = node.kind === "ask" ? node.question : undefined;
		const level = q?.evaluation.draft.access;
		if (q === undefined || level === undefined) continue;
		asks.set(q.alias, [
			...(asks.get(q.alias) ?? []),
			{
				path: `${node.path}.ask`,
				question: `${q.alias}.${q.name}`,
				level,
				held: q.evaluation.findings.some((f) => f.path === "access"),
			},
		]);
	}
	return asks;
}

/**
 * The levels instruments ask questions at, whatever bank they come from: their
 * workspace declares them (`access-undeclared`), so they're used (`unusedLevels`). A
 * level held because a question's own is missing counts here, unlike in `levelsNamed`:
 * `access-undeclared` asks for it, so it is used.
 */
export const levelsAsked = (
	drafts: Iterable<InstrumentDraft>,
): ReadonlySet<string> =>
	new Set(
		[...drafts].flatMap((d) =>
			[...asksByBank(d).values()].flatMap((asks) => asks.map((a) => a.level)),
		),
	);

/**
 * What the host workspace lacks to cover a bank's access policy. Each ask at a level the
 * host's `workspace.yaml` doesn't declare is said where it's asked; levels both list in
 * different orders are said at the bank's use, naming an ask they touch (the first). A
 * level is declared to make the host's policy cover it: the question keeps its own
 * bank's policy, never re-ranked.
 */
function hostCovers(
	host: readonly string[],
	alias: string,
	home: readonly string[] | undefined,
	asks: readonly Ask[],
): readonly Finding[] {
	if (home === undefined || home.length === 0) return [];
	const code = (xs: readonly string[]) => andList(xs.map((x) => `\`${x}\``));
	const at = (a: Ask) =>
		a.held
			? `\`${a.question}\` is held at \`${a.level}\` (its own \`access\` line is missing or unreadable)`
			: `\`${a.question}\` is asked at \`${a.level}\``;
	const findings: Finding[] = asks
		.filter((a) => !host.includes(a.level))
		.map((a) => ({
			code: "access-undeclared",
			severity: "error",
			path: a.path,
			message:
				host.length === 0
					? `${at(a)}, and this workspace declares no access levels.`
					: `${at(a)}, which this workspace doesn't declare.`,
			hint: `Add \`${a.level}\` to the \`access\` list in this workspace's \`workspace.yaml\`, in the order \`${alias}\` gives: ${code(home)}, most open first.`,
		}));
	const order = (levels: readonly string[], other: readonly string[]) =>
		levels.filter((l) => other.includes(l));
	const shared = order(home, host);
	// Only where an asked level stands: the order of levels nothing is asked at isn't this instrument's.
	const before = (levels: readonly string[], a: string, b: string) =>
		levels.indexOf(a) < levels.indexOf(b);
	const touched = asks.find(
		(a) =>
			shared.includes(a.level) &&
			shared.some(
				(b) =>
					b !== a.level &&
					before(home, a.level, b) !== before(host, a.level, b),
			),
	);
	if (touched !== undefined)
		findings.push({
			code: "access-order",
			severity: "error",
			path: `uses.${alias}`,
			message: `\`${alias}\` orders its access levels ${code(shared)}, and this workspace orders them ${code(order(host, home))}. ${at(touched)}.`,
			hint: `Put the levels in this workspace's \`workspace.yaml\` in the order \`${alias}\` gives, most open first.`,
		});
	return findings;
}

/**
 * Where an asked question's bank codes data otherwise than the instrument's workspace: a
 * missing-value list that isn't the same codes with the same labels (order aside), and,
 * for a select-all question, other codes for chosen and not chosen (labels aside). Said
 * at the ask; the DDI keeps the bank's coding, so these are warnings, not refusals.
 */
function conventionFindings(
	host: Host,
	home: Pick<Env, "missing" | "selectAll">,
	ask: {
		readonly path: string;
		readonly question: string;
		readonly selectAll: boolean;
	},
): readonly Finding[] {
	const findings: Finding[] = [];
	const q = `\`${ask.question}\``;
	const codes = (xs: readonly { code: string }[]) =>
		andList(xs.map((x) => `\`${x.code}\``));
	const labels = new Map(host.missing.map((c) => [c.code, c.label]));
	const same =
		home.missing.length === host.missing.length &&
		home.missing.every((c) => labels.get(c.code) === c.label);
	if (!same) {
		const sameCodes =
			home.missing.length === host.missing.length &&
			home.missing.every((c) => labels.has(c.code));
		const relabelled = home.missing.filter(
			(c) => labels.get(c.code) !== c.label,
		);
		findings.push({
			code: "missing-differs",
			severity: "warning",
			path: ask.path,
			message:
				host.missing.length === 0
					? `${q} codes missing values as ${codes(home.missing)}, and this workspace declares none.`
					: home.missing.length === 0
						? `${q} has no missing values, and this workspace codes them as ${codes(host.missing)}.`
						: sameCodes
							? `${q} labels missing values differently from this workspace (${relabelled.map((c) => `\`${c.code}\` "${c.label}" against "${labels.get(c.code)}"`).join(", ")}).`
							: `${q} codes missing values differently from this workspace (${codes(home.missing)} against ${codes(host.missing)}).`,
			hint: "Make this workspace's `missing.yaml` and its bank's agree, or keep both: the DDI keeps each question's own.",
		});
	}
	const theirs = home.selectAll;
	const ours = host.selectAll;
	if (
		ask.selectAll &&
		(theirs.chosen.code !== ours.chosen.code ||
			theirs.notChosen.code !== ours.notChosen.code)
	)
		findings.push({
			code: "select-all-differs",
			severity: "warning",
			path: ask.path,
			message: `${q} stores select all that apply as \`${theirs.chosen.code}\` chosen and \`${theirs.notChosen.code}\` not; this workspace stores \`${ours.chosen.code}\` and \`${ours.notChosen.code}\`.`,
			hint: "Make this workspace's `select_all.yaml` and its bank's agree, or keep both: the DDI keeps each question's own.",
		});
	return findings;
}

/** Names as a reader lists them: "a", "a and b", "a, b and c". */
const andList = (xs: readonly string[]): string =>
	xs.length <= 1
		? xs.join("")
		: `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

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
				message: `${andList(c.keys.map((k) => `\`${k}\``))} would share one DDI name, \`${c.urn}\`.`,
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
			message: `${who} publish as \`${agency}\` but store select all that apply options differently.`,
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
