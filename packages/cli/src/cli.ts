/**
 * The `qretools` command: `check` a workspace directory's findings (its questions',
 * shared files' and instruments'), as compilers report them, `export` its questions' DDI,
 * write their `codebook` (an HTML page of that DDI, or of any DDI document), write an
 * instrument's test `form` (an HTML page that runs its routing, from its DDI), report its
 * `paths` (an HTML page of how many ways through its routing, and what each reaches),
 * or `build` it: the DDI of its last commit, each item at the version its history gives,
 * with each instrument's Qualtrics survey; make that survey's column map (`qsf-map`); and read
 * its `responses` back, keyed by DDI Variable URN. `main` takes its
 * output as values (`Io`), so it runs in a
 * test as it runs in a shell; the bin only wires it to the process.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { codebookOf, pageOf, parse as readDdi } from "@qretools/codebook";
import {
	type Address,
	accessPoliciesOf,
	addressOf,
	agencyWritten,
	answersCsv,
	answersOf,
	type Bank,
	type BankScope,
	bankOf,
	collisions,
	type DataMap,
	type DdiDocument,
	dataFileMap,
	dataMapOf,
	ddiIndexOf,
	documentOf,
	exportRefusal,
	type FilterRefusal,
	type Finding,
	filterAnswers,
	HERE,
	type Host,
	type Item,
	importsOf,
	inDocumentOrder,
	instrumentAt,
	instrumentOf,
	instrumentPath,
	instrumentRelease,
	locate,
	locksFor,
	locksWritten,
	makeValidator,
	movedTags,
	notHere,
	placeFindings,
	questionItems,
	type Range,
	type Refusal,
	type RemoteBank,
	type Representation,
	type Result,
	ROOT,
	readInstruments,
	readResponses,
	releaseFindings,
	remoteScope,
	remotesOf,
	type Severity,
	scopeOf,
	shortCommit,
	status,
	type TagRef,
	tagMessage,
	tagRefOf,
	tickCodes,
	unlockedTags,
	type Validator,
	versionsOf,
	WORKSPACE,
	withLocks,
	workspaceOf,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { pathsPageOf } from "@qretools/paths";
import {
	type ColumnMap,
	columnMapOf,
	exportMap,
	qsfMapOf,
	qsfOf,
	qsfRefusalReason,
	qsfTime,
} from "@qretools/qualtrics";
import pkg from "../package.json" with { type: "json" };
import type { HistoryRead, OwnRepository } from "./history.ts";

/** Where the command writes: findings or the DDI on `out`, everything said to people on `err`. */
export interface Io {
	readonly out: (text: string) => void;
	readonly err: (text: string) => void;
	readonly writeFile: (path: string, text: string) => Promise<void>;
	/** Removes a file the command wrote before, if it's there. */
	readonly removeFile: (path: string) => Promise<void>;
	/**
	 * A workspace in another repository, read at its tag (the command uses git:
	 * `readTagged`); `from` is a local clone to read it from in place of GitHub.
	 */
	readonly readRemote: (
		address: RemoteAddress,
		from?: string,
	) => Promise<RemoteBank>;
	/** The repository a folder is a clone of, and the clone's folder (`ownRepository`). */
	readonly ownRepository: (dir: string) => Promise<OwnRepository | undefined>;
	/** The workspace in a directory at its last commit, with its history (the command uses git: `readHistory`). */
	readonly readHistory: (dir: string) => Promise<HistoryRead>;
}

type RemoteAddress = Extract<Address, { kind: "remote" }>;

const USAGE = `Usage:
  qretools check [dir] [--strict]   Report a workspace's findings; fail on anything to fill in or fix
  qretools export [dir] [-o file]   Write its questions' DDI-Lifecycle 4.0 JSON
  qretools codebook [dir | file.json] [-o file] [--strict]
                                    Write a codebook, one HTML page: of its questions' DDI, or of
                                    any DDI-Lifecycle 4.0 JSON file
  qretools paths <file.json> [-o file]
                                    Write a report of an instrument's paths, one HTML page: how many
                                    ways through its routing, and which questions each reaches, from
                                    its DDI (as \`instrument export\` writes it)
  qretools build [dir] [-o outdir] [--tag-message file]
                                    Write its last commit's DDI, versioned from its git history, to outdir/ddi.json (default dir/dist),
                                    and each instrument's to outdir/instruments/<name>.json, with its Qualtrics
                                    survey (<name>.qsf); an instrument Qualtrics can't run gets a warning instead
                                    of the survey. Copies each column map in maps/, <name>-ddi-<source>.columns.json,
                                    beside its instrument's DDI, with a warning if it was made from another DDI.
                                    Refused while an instrument is incomplete, reads this workspace as \`../\`,
                                    or reads a tag it hasn't locked or that has moved, or a map in maps/ names
                                    no instrument it builds or can't be read as the source its name gives
  qretools qsf-map <name.json | owner/repo@tag:name> -o <dir>
                                    Write the QSF column map of an instrument's DDI (as \`build\` writes it, or
                                    from a release: see "Tag references"), from the response columns of its
                                    Qualtrics survey to its DDI variables, to dir/<name>-ddi-qsf.columns.json.
                                    Not written if Qualtrics can't run the survey
  qretools responses <export.csv> --map <name>-ddi-qsf.columns.json [--ddi file | owner/repo@tag:name] [-o file]
                                    Read a Qualtrics response export (CSV, export values, multi-value
                                    fields split into columns) into long CSV, one line per value:
                                    respondent,variable,row,value, each variable by its DDI URN. Reads
                                    the DDI from --ddi, else <name>.json beside the map, else the release
                                    the map names. Survey Preview and test
                                    responses are kept. Writes to stdout unless -o names a file:
                                    keep it out of anything published (dist/ goes to Pages)
  qretools responses <data.csv> --map <name>-ddi-<source>.columns.json [--ddi file] [-o file]
                                    Read a data file (CSV, one header row) the same way, with a map
                                    that names each column by its header, with its DDI variable and
                                    any translations of its values. Every row is read
  qretools filter <answers.csv> --ddi <file.json> --access <level> [-o file]
                                    Keep the answers (long CSV, as \`responses\` writes it) to
                                    variables at that access level or a more open one, each by the
                                    access policy of its own workspace, as the DDI gives it; name each
                                    variable removed on stderr, never a value. Refused, with nothing
                                    written, when a variable's level can't be traced to its policy, or
                                    the DDI has no levels
  qretools filter --ddi <file.json> List each access policy in the DDI: its levels, most open first,
                                    and how many variables stand at each
  qretools instrument check <file> [--agency <agency>] [--bank alias=dir]... [--strict]
  qretools instrument export <file> [--agency <agency>] [--bank alias=dir]... [--qsf] [-o file]

dir is the workspace's folder (default: the current directory): workspace.yaml,
questions/<folder>/, the shared folders (scales/ and so on), missing.yaml,
select_all.yaml and instruments/.
An instrument reads its own workspace as \`../\` in its \`uses\`, and other workspaces at
a tag, such as \`owner/repo@v1\` (this needs git). A tag can move, so \`instrument export\`
records the commit each tag points to, under \`locked:\` in workspace.yaml. If a tag
moves after that, check warns until the next export records it again.
--bank    read an alias written as \`owner/repo@v1\` from a directory instead, to work offline.
--strict  also fail on warnings; for codebook, also fail when the DDI refers to
          something it doesn't contain (the page is written either way).
--tag-message  also write the text for a release's tag: each file's version, so
          workspaces that use this release can read them, and each instrument's
          version and DDI digest, so a tag reference can rebuild its DDI.
--agency  the instrument's DDI agency, in place of its workspace's (workspace.yaml).
          Needed for a file outside a workspace's instruments/.
--ddi     the DDI a column map was made from (a file or a tag reference), in place of
          <name>.json beside the map or the release the map names; for filter, the DDI the
          answers refer to.

Tag references: owner/repo[/folder]@tag:name names the instrument \`name\` in a release
of a workspace (a tag made with \`build --tag-message\`). The command reads the tag with
git, rebuilds the instrument's DDI, and uses it only if its digest is the one the release
recorded. If not, it names the version of qretools that built the release.
--access  for filter, the access level to keep, with every more open one.
--qsf     write the instrument as a Qualtrics survey (QSF) instead of its DDI. Refused
          if any part of it can't work in Qualtrics as the DDI says.`;

/** What to say when a directory holds nothing the tool reads: the wrong folder, most likely. */
const nothingIn = (dir: string): string =>
	`Nothing to read in ${dir}: a workspace has workspace.yaml, questions/<folder>/, scales/, instruments/ and so on.\n`;

/** How many files a bank read as something: its questions and shared files. */
const readIn = (bank: Bank): number =>
	Object.keys(bank.questions).length + Object.keys(bank.schemes).length;

/** Exit codes: 0 fine, 1 the workspace has problems (or can't be exported), 2 the command couldn't run. */
const OK = 0;
const PROBLEMS = 1;
const USAGE_ERROR = 2;

export async function main(argv: readonly string[], io: Io): Promise<number> {
	let args: ReturnType<typeof parse>;
	try {
		args = parse(argv);
	} catch (e) {
		io.err(`${e instanceof Error ? e.message : String(e)}\n${USAGE}\n`);
		return USAGE_ERROR;
	}
	if (args.positionals[0] === "instrument") return instrument(args, io);
	const [command, dir = ".", ...extra] = args.positionals;
	if (args.values.help || command === undefined || extra.length > 0) {
		(args.values.help ? io.out : io.err)(`${USAGE}\n`);
		return args.values.help ? OK : USAGE_ERROR;
	}
	if (
		command !== "check" &&
		command !== "export" &&
		command !== "build" &&
		command !== "codebook" &&
		command !== "paths" &&
		command !== "responses" &&
		command !== "filter" &&
		command !== "qsf-map"
	) {
		io.err(`Unknown command \`${command}\`.\n${USAGE}\n`);
		return USAGE_ERROR;
	}
	// Each option belongs to one command; given to the other, it's a mistake, not ignored.
	const stray =
		command !== "responses" && args.values.map !== undefined
			? "--map"
			: command !== "responses" &&
					command !== "filter" &&
					args.values.ddi !== undefined
				? "--ddi"
				: command !== "filter" && args.values.access !== undefined
					? "--access"
					: args.values.bank !== undefined
						? "--bank"
						: args.values.agency !== undefined
							? "--agency"
							: args.values.qsf === true
								? "--qsf"
								: command !== "build" &&
										args.values["tag-message"] !== undefined
									? "--tag-message"
									: command === "check"
										? args.values.output !== undefined && "--output"
										: command !== "codebook" &&
											args.values.strict === true &&
											"--strict";
	if (stray) {
		io.err(`\`${stray}\` isn't an option of \`${command}\`.\n${USAGE}\n`);
		return USAGE_ERROR;
	}
	if (command === "check")
		return checkWorkspace(dir, args.values.strict === true, io);
	if (command === "build")
		return build(
			dir,
			args.values.output ?? join(dir, "dist"),
			args.values["tag-message"],
			io,
		);
	if (command === "responses") {
		if (args.positionals[1] === undefined || args.values.map === undefined) {
			io.err(`${USAGE}\n`);
			return USAGE_ERROR;
		}
		return writeResponses(
			dir,
			args.values.map,
			args.values.ddi,
			args.values.output,
			io,
		);
	}
	if (command === "filter") {
		if (args.values.ddi === undefined) {
			io.err(`${USAGE}\n`);
			return USAGE_ERROR;
		}
		return writeFiltered(
			args.positionals[1],
			args.values.ddi,
			args.values.access,
			args.values.output,
			io,
		);
	}
	if (command === "qsf-map") {
		// A file, always, and a folder: the map's name says its kind, so it has no stdout form.
		if (args.positionals[1] === undefined || args.values.output === undefined) {
			io.err(`${USAGE}\n`);
			return USAGE_ERROR;
		}
		return writeQsfMap(dir, args.values.output, io);
	}
	if (command === "paths") {
		// A file, always: there's no workspace default to fall back on.
		if (args.positionals[1] === undefined) {
			io.err(`${USAGE}\n`);
			return USAGE_ERROR;
		}
		return writePaths(dir, args.values.output, io);
	}
	const strict = args.values.strict === true;
	// A file is a DDI document, any producer's; a directory is a workspace.
	if (
		command === "codebook" &&
		(await stat(dir).then(
			(s) => s.isFile(),
			() => false,
		))
	) {
		let text: string;
		try {
			text = await readFile(dir, "utf8");
		} catch (e) {
			io.err(
				`Can't read ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
			);
			return USAGE_ERROR;
		}
		return emit(
			renderCodebook(jsonOf(text), dir, strict),
			args.values.output,
			io,
		);
	}
	let files: Readonly<Record<string, string>>;
	try {
		files = await readWorkspace(dir);
	} catch (e) {
		io.err(
			`Can't read the workspace at ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
		);
		return USAGE_ERROR;
	}
	// The export is the questions': its instruments aren't the bank's files.
	const bank = bankOf(
		Object.fromEntries(
			Object.entries(files).filter(([p]) => instrumentAt(p) === undefined),
		),
	);
	if (readIn(bank) === 0) {
		io.err(nothingIn(dir));
		return USAGE_ERROR;
	}
	return exportBank(
		bank,
		args.values.output,
		io,
		command === "codebook"
			? (document) => renderCodebook({ ok: true, value: document }, dir, strict)
			: asJson,
	);
}

/** What a command writes: the text, if any, and lines to say on stderr; `problems` fails it. */
interface Rendered {
	readonly text?: string;
	readonly lines: readonly string[];
	readonly problems: boolean;
}

/** Writes what was rendered: its lines on stderr, its text to the file or stdout. */
async function emit(
	r: Rendered,
	output: string | undefined,
	io: Io,
): Promise<number> {
	for (const line of r.lines) io.err(`${line}\n`);
	if (r.text !== undefined)
		if (output === undefined) io.out(r.text);
		else await io.writeFile(output, r.text);
	return r.problems ? PROBLEMS : OK;
}

/** A DDI document as every command writes it, and as the QSF exporter digests it. */
const ddiText = (document: DdiDocument): string =>
	`${JSON.stringify(document, null, 2)}\n`;

/** A file's SHA-256 digest as a map and a survey record it, so `shasum -a 256` agrees. */
const digestOf = (text: string): string =>
	`sha256:${createHash("sha256").update(text).digest("hex")}`;

/** The DDI as `export` writes it. */
const asJson = (document: DdiDocument): Rendered => ({
	text: ddiText(document),
	lines: [],
	problems: false,
});

type Json =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly detail: string };

/** A file's text as JSON, or why it isn't. */
const jsonOf = (text: string): Json => {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch (e) {
		return { ok: false, detail: e instanceof Error ? e.message : String(e) };
	}
};

/**
 * A DDI document as its codebook: one HTML page, and a line in `check`'s form for each
 * reference to an item the document doesn't have, since CI never reads the page. Not
 * written when it isn't a DDI document. `strict` fails on a broken reference; the page
 * is written either way. `input` names what was read: the file, or the workspace.
 */
function renderCodebook(json: Json, input: string, strict: boolean): Rendered {
	if (!json.ok)
		return {
			lines: [
				`${input}: error: Not written: this isn't JSON (${json.detail}). [codebook-unreadable]`,
			],
			problems: true,
		};
	const read = readDdi(json.value);
	if (!read.ok)
		return {
			lines: read.error.map(
				(f) => `${input}: error: Not written: ${f.message} [${f.code}]`,
			),
			problems: true,
		};
	const codebook = codebookOf(read.value);
	return {
		text: pageOf(codebook),
		lines: codebook.findings.map(
			(f) =>
				`${input}: ${LEVEL[f.severity]}: ${f.path === "" ? "" : `${f.path}: `}${f.message} [${f.code}]`,
		),
		problems: strict && codebook.findings.length > 0,
	};
}

/**
 * An instrument's DDI from its workspace's release (`owner/repo@tag:name`): rebuilt from
 * the files at the tag, with the versions its tag's message gives (`instrumentRelease`),
 * and used only when its digest is the one the release recorded. Exact, or refused with
 * the version of QREtools that built the release: never a guess. Read with git
 * (`readTagged`), so a tag read once is served from the cache offline.
 */
async function ddiAtRelease(
	ref: TagRef,
	io: Io,
): Promise<
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly reason: string }
> {
	const read = await io.readRemote(ref.address);
	if (read.kind === "unavailable") return { ok: false, reason: read.reason };
	const path = instrumentPath(ref.name);
	const release = instrumentRelease(
		read.at?.message ?? "",
		read.at?.blobs ?? {},
		path,
	);
	if (release.kind === "refused") return { ok: false, reason: release.reason };
	// Its banks as `build` read them, at the tags the release locked; its own repository's
	// too, from GitHub, since the cached clone holds only this tag.
	const remote = await readRemotes(read.files, io, undefined);
	const one = workspaceOf(read.files, { remote, versions: release.versions })
		.instruments[path];
	const text = one === undefined ? "" : ddiText(one.instrument.ddi);
	if (digestOf(text) === release.ddi) return { ok: true, text };
	return {
		ok: false,
		reason:
			release.qretools === pkg.version
				? `Rebuilt from the tag, its DDI isn't the one the release recorded (${release.ddi}), although QREtools ${pkg.version} built both.`
				: `QREtools ${release.qretools} built this release, and QREtools ${pkg.version} rebuilds its DDI differently. Run the same command again with \`npx qretools@${release.qretools}\`.`,
	};
}

/**
 * The QSF column map of an instrument's DDI (a file as `build` writes it, or a tag
 * reference to its release, `ddiAtRelease`), to `<out>/<name>-ddi-qsf.columns.json`:
 * made as the survey is, by `qsfMapOf`, with the DDI's digest, so `responses` reads an
 * export only with that DDI, and the release it came from. Written with warnings for
 * columns it can't name; not written when Qualtrics can't run the survey.
 */
async function writeQsfMap(
	input: string,
	out: string,
	io: Io,
): Promise<number> {
	const ref = tagRefOf(input);
	let text: string;
	if (ref !== undefined) {
		const got = await ddiAtRelease(ref, io);
		if (!got.ok) {
			io.err(`${input}: error: Not written: ${got.reason} [qsf-map-release]\n`);
			return PROBLEMS;
		}
		text = got.text;
	} else
		try {
			text = await readFile(input, "utf8");
		} catch (e) {
			io.err(
				`Can't read ${input}: ${e instanceof Error ? e.message : String(e)}\n`,
			);
			return USAGE_ERROR;
		}
	const json = jsonOf(text);
	// The trust boundary: DDI the official schema accepts, before the package reads it.
	const invalid = json.ok ? await validate(json.value as DdiDocument) : [];
	if (!json.ok || invalid.length > 0) {
		for (const f of invalid)
			io.err(
				`${input}: error: ${f.path === "" ? "" : `${f.path}: `}${f.message}\n`,
			);
		io.err(
			`${input}: error: Not written: this isn't DDI-Lifecycle 4.0 JSON. [qsf-map-unreadable]\n`,
		);
		return PROBLEMS;
	}
	const made = qsfMapOf(json.value as DdiDocument, {
		digest: digestOf(text),
		version: pkg.version,
	});
	for (const f of made.findings.filter(
		(f) => f.code === "qsf-unmapped" || f.severity === "error",
	))
		io.err(
			`${input}: ${LEVEL[f.severity]}: ${f.path === "" ? "" : `${f.path}: `}${f.message} [${f.code}]\n`,
		);
	if (made.kind === "refused") {
		io.err(`${input}: error: Not written: ${qsfRefusalReason(made.errors)}\n`);
		return PROBLEMS;
	}
	const { columns, ...head } = made.columns;
	await io.writeFile(
		join(out, `${ref?.name ?? basename(input, ".json")}-ddi-qsf.columns.json`),
		`${JSON.stringify(ref === undefined ? made.columns : { ...head, release: ref.text, columns }, null, 2)}\n`,
	);
	return OK;
}

/**
 * A DDI file's instruments' paths as one HTML page, and a line in `check`'s form for each
 * part of the DDI it can't read. Not written when the file isn't DDI or holds no instrument.
 */
async function writePaths(
	file: string,
	output: string | undefined,
	io: Io,
): Promise<number> {
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch (e) {
		io.err(
			`Can't read ${file}: ${e instanceof Error ? e.message : String(e)}\n`,
		);
		return USAGE_ERROR;
	}
	const json = jsonOf(text);
	if (!json.ok)
		return emit(
			{
				lines: [
					`${file}: error: Not written: this isn't JSON (${json.detail}). [paths-unreadable]`,
				],
				problems: true,
			},
			output,
			io,
		);
	const read = readInstruments(ddiIndexOf(json.value));
	const lines = read.findings.map(
		(f) =>
			`${file}: ${LEVEL[f.severity]}: ${f.path === "" ? "" : `${f.path}: `}${f.message} [${f.code}]`,
	);
	if (read.value.instruments.length === 0)
		return emit(
			{
				lines: [
					...lines,
					`${file}: error: Not written: there's no instrument in this DDI. [paths-unreadable]`,
				],
				problems: true,
			},
			output,
			io,
		);
	return emit(
		{ text: pathsPageOf(read.value), lines, problems: false },
		output,
		io,
	);
}

/**
 * A map's name: `<name>-ddi-<source>.columns.json`, beside the DDI `<name>.json` it was
 * made from. Its `source` field says what kind of map it is, and must agree with the name:
 * `qsf` is the QSF column map `qsf-map` writes; any other source is a data file's map.
 */
const MAP_NAME = /-ddi-([a-z0-9]+)\.columns\.json$/;

/** A column map read from its JSON, as its name's source says it is, or why it can't be. */
type MapRead =
	| {
			readonly kind: "read";
			readonly map: ColumnMap | DataMap;
	  }
	| { readonly kind: "unreadable"; readonly reason: string };

/**
 * A map's text read as the source its name gives (`MAP_NAME`): its `source` field must
 * agree, and `qsf` reads as a QSF column map, any other as a data file's map. The one
 * rule `responses` and `build` both apply.
 */
function mapOf(named: string, text: string): MapRead {
	const json = jsonOf(text);
	if (!json.ok)
		return { kind: "unreadable", reason: `this isn't JSON (${json.detail}).` };
	const source =
		typeof json.value === "object" && json.value !== null
			? (json.value as Record<string, unknown>).source
			: undefined;
	if (typeof source !== "string")
		return {
			kind: "unreadable",
			reason: `this map has no \`source\` field, which says what it reads. ${named === "qsf" ? "Make it again with `qretools qsf-map`." : `Add \`"source": "${named}"\`.`}`,
		};
	if (source !== named)
		return {
			kind: "unreadable",
			reason: `its name says the source \`${named}\`, but its \`source\` field says \`${source}\`.`,
		};
	const qsf = source === "qsf";
	const map = qsf ? columnMapOf(json.value) : dataMapOf(json.value);
	return map === undefined
		? {
				kind: "unreadable",
				reason: `this isn't a ${qsf ? "QSF column map" : "data file's column map"}.`,
			}
		: { kind: "read", map };
}

/**
 * Responses read with a column map, as long CSV: one line per value, keyed by DDI Variable
 * URN (`answersCsv`). A QSF column map reads a Qualtrics response export; any other map
 * reads a data file with one header row, its columns by header name. The DDI (beside the
 * map, or `--ddi`) gives each variable's codes and a select-all option's tick, and must be
 * the DDI the map was made from (its digest). Findings place what can't be read by line
 * and column, never by a response's value. Local files only.
 */
async function writeResponses(
	file: string,
	mapFile: string,
	ddiOption: string | undefined,
	output: string | undefined,
	io: Io,
): Promise<number> {
	const named = MAP_NAME.exec(mapFile);
	if (named === null) {
		io.err(
			`${mapFile}: a column map's name ends in \`-ddi-<source>.columns.json\`, as \`qsf-map\` names the QSF one (\`-ddi-qsf.columns.json\`).\n`,
		);
		return USAGE_ERROR;
	}
	const texts: string[] = [];
	for (const f of [file, mapFile])
		try {
			texts.push(await readFile(f, "utf8"));
		} catch (e) {
			io.err(
				`Can't read ${f}: ${e instanceof Error ? e.message : String(e)}\n`,
			);
			return USAGE_ERROR;
		}
	const [csv = "", mapText = ""] = texts;
	const opened = mapOf(named[1] ?? "", mapText);
	if (opened.kind === "unreadable") {
		io.err(`${mapFile}: error: ${opened.reason} [responses-unreadable]\n`);
		return PROBLEMS;
	}
	const { map } = opened;
	// `--ddi`, else the DDI beside the map (where `build` copies it), else the release it
	// names: the map's digest checks whichever it is.
	const release = "release" in map ? map.release : undefined;
	const beside = `${mapFile.slice(0, named.index)}.json`;
	const besideThere = await stat(beside).then(
		(s) => s.isFile(),
		() => false,
	);
	if (ddiOption === undefined && !besideThere && release === undefined) {
		io.err(
			`${mapFile}: there's no DDI ${beside} beside the map, and the map names no release. Give the DDI it was made from with \`--ddi\`.\n`,
		);
		return USAGE_ERROR;
	}
	const ddiFile =
		ddiOption ?? (besideThere || release === undefined ? beside : release);
	const ref = tagRefOf(ddiFile);
	if (ddiFile === release && ref === undefined) {
		io.err(
			`${mapFile}: error: the map's release \`${release}\` isn't a tag reference (\`owner/repo@tag:name\`). [responses-unreadable]\n`,
		);
		return PROBLEMS;
	}
	let ddiText: string;
	if (ref !== undefined) {
		const got = await ddiAtRelease(ref, io);
		if (!got.ok) {
			io.err(`${ddiFile}: error: ${got.reason} [responses-release]\n`);
			return PROBLEMS;
		}
		ddiText = got.text;
	} else
		try {
			ddiText = await readFile(ddiFile, "utf8");
		} catch (e) {
			io.err(
				`Can't read ${ddiFile}: ${e instanceof Error ? e.message : String(e)}\n`,
			);
			return USAGE_ERROR;
		}
	if (map.ddi !== undefined && map.ddi !== digestOf(ddiText)) {
		io.err(
			`${ddiFile}: error: this isn't the DDI the map was made from (its digest differs). [responses-provenance]\n`,
		);
		return PROBLEMS;
	}
	if (map.ddi === undefined)
		io.err(
			`${mapFile}: note: the map names no DDI digest, so ${ddiFile} isn't checked against it. [responses-provenance]\n`,
		);
	const ddiJson = jsonOf(ddiText);
	const read = ddiJson.ok ? readDdi(ddiJson.value) : undefined;
	if (read?.ok !== true) {
		io.err(
			`${ddiFile}: error: this isn't DDI-Lifecycle 4.0 JSON. [responses-unreadable]\n`,
		);
		return PROBLEMS;
	}
	const index = read.value;
	// Each variable's codes or format, and each select-all option's tick, as the DDI says.
	const ticks = tickCodes(index, [...index.byUrn.values()]);
	const representations = new Map<string, Representation>();
	const ticked = new Map<string, string>();
	for (const e of codebookOf(index).entries) {
		if (e.type !== "Variable") continue;
		const codes = (e.responses?.rows ?? []).map((r) => r.code);
		// shortcut: missing values written as ranges aren't read (the codebook reads codes only), so a number in one is a finding.
		if (e.format?.kind === "number")
			representations.set(e.urn, {
				kind: "number",
				missing: codes,
				...(e.format.min !== undefined && { min: e.format.min }),
				...(e.format.max !== undefined && { max: e.format.max }),
			});
		else if (e.format?.kind === "text")
			representations.set(e.urn, { kind: "text" });
		else if (e.responses !== undefined)
			representations.set(e.urn, { kind: "codes", codes });
		// Anything else (a date, say) isn't read: its column is a finding, never taken as text.
		const tick = e.responses?.from
			.map((f) => (f.kind === "ref" ? ticks.get(f.urn)?.ticked : undefined))
			.find((t) => t !== undefined);
		if (tick !== undefined) ticked.set(e.urn, tick);
	}
	const made =
		"respondent" in map ? dataFileMap(csv, map) : exportMap(csv, map, ticked);
	const answered =
		made.map === undefined
			? undefined
			: readResponses(made.header, made.rows, made.map, representations);
	const findings = [...made.findings, ...(answered?.findings ?? [])];
	for (const f of findings)
		io.err(
			`${file}${f.line === undefined ? "" : `:${f.line}`}: ${LEVEL[f.severity]}: ${f.column === undefined ? "" : `column \`${f.column}\`: `}${f.message}${f.count > 1 ? ` (${f.count} rows)` : ""} [${f.code}]\n`,
		);
	if (answered !== undefined)
		await emit(
			{ text: answersCsv(answered.answers), lines: [], problems: false },
			output,
			io,
		);
	return findings.some((f) => f.severity === "error") ? PROBLEMS : OK;
}

/**
 * Answers (long CSV, as `responses` writes them) filtered to an access level and every
 * more open one of each variable's own policy, by the DDI alone (`filterAnswers`);
 * without a level, each policy the DDI holds, its URN then its levels, most open first,
 * each with how many variables stand at it. Says which variables it removed, never a
 * value. Refused, with nothing written, whenever a level can't be told (`FilterRefusal`).
 */
async function writeFiltered(
	file: string | undefined,
	ddiFile: string,
	level: string | undefined,
	output: string | undefined,
	io: Io,
): Promise<number> {
	if (level !== undefined && file === undefined) {
		io.err(`${USAGE}\n`);
		return USAGE_ERROR;
	}
	const texts: string[] = [];
	for (const f of level === undefined ? [ddiFile] : [ddiFile, file ?? ""])
		try {
			texts.push(await readFile(f, "utf8"));
		} catch (e) {
			io.err(
				`Can't read ${f}: ${e instanceof Error ? e.message : String(e)}\n`,
			);
			return USAGE_ERROR;
		}
	const [ddiText = "", csv = ""] = texts;
	const ddiJson = jsonOf(ddiText);
	const read = ddiJson.ok ? readDdi(ddiJson.value) : undefined;
	if (read?.ok !== true) {
		io.err(
			`${ddiFile}: error: this isn't DDI-Lifecycle 4.0 JSON. [filter-unreadable]\n`,
		);
		return PROBLEMS;
	}
	const index = read.value;
	const refuse = (lines: readonly string[]) => {
		for (const l of lines) io.err(`${l} Nothing is written.\n`);
		return PROBLEMS;
	};
	if (level === undefined) {
		const listed = accessPoliciesOf(index);
		if (!listed.ok)
			return refuse(filterRefusal(listed.error, ddiFile, ddiFile));
		const { policies, untraced } = listed.value;
		if (policies.length === 0)
			io.err(
				`${ddiFile}: note: this DDI defines no access levels. [filter-no-levels]\n`,
			);
		for (const p of policies) {
			io.out(`${p.urn}\n`);
			p.levels.forEach((l, i) => {
				io.out(`  ${l} ${p.counts[i] ?? 0}\n`);
			});
		}
		if (untraced.length > 0)
			io.err(
				`${ddiFile}: warning: ${untraced.length} variables have no access level that can be traced to a policy, so \`filter\` refuses their answers. [filter-untraced]\n`,
			);
		return OK;
	}
	const answers = answersOf(csv);
	if (!answers.ok)
		return refuse([
			`${file}${answers.error.line === undefined ? "" : `:${answers.error.line}`}: error: ${answers.error.message} [filter-unreadable]`,
		]);
	const filtered = filterAnswers(index, answers.value, level);
	if (!filtered.ok)
		return refuse(filterRefusal(filtered.error, ddiFile, file ?? ""));
	const code = await emit(
		{ text: answersCsv(filtered.value.kept), lines: [], problems: false },
		output,
		io,
	);
	// Said once the answers are written: a write that fails has removed nothing.
	for (const r of filtered.value.removed)
		io.err(
			`${file}: note: removed \`${r.name}\` (${r.urn}), at \`${r.level}\`. [filter-removed]\n`,
		);
	return code;
}

/** Why answers weren't filtered, a line each, as `check` writes findings: URNs and levels, never a value. */
function filterRefusal(
	r: FilterRefusal,
	ddiFile: string,
	file: string,
): readonly string[] {
	const named = (xs: readonly string[]) => xs.map((x) => `\`${x}\``).join(", ");
	switch (r.kind) {
		case "unreadable-levels":
			return [
				`${ddiFile}: error: The DDI's access levels can't be read: ${r.reason}. [filter-levels]`,
			];
		case "unknown-level":
			return r.policies.map(
				(p) =>
					`${ddiFile}: error: The access policy ${p.urn} has no level \`${r.level}\`. Its levels are ${named(p.levels)}, most open first. [filter-unknown-level]`,
			);
		case "no-levels":
			return [
				`${ddiFile}: error: This DDI defines no access levels, so \`--access\` means nothing here. [filter-no-levels]`,
			];
		case "unknown-variables":
			return r.urns.map(
				(u) =>
					`${file}: error: The DDI has no variable \`${u}\`, so its access level isn't known. [filter-unknown-variable]`,
			);
		case "untraced":
			return r.urns.map(
				(u) =>
					`${ddiFile}: error: The access level of \`${u}\` can't be traced to one access policy in the DDI. [filter-untraced]`,
			);
		case "leak":
			return r.urns.map(
				(u) =>
					`${file}: error: Answers to \`${u}\`, above the level, remained after filtering: a bug in QREtools. [filter-leak]`,
			);
		default:
			return r satisfies never;
	}
}

function parse(argv: readonly string[]) {
	return parseArgs({
		args: [...argv],
		allowPositionals: true,
		strict: true,
		options: {
			strict: { type: "boolean" },
			output: { type: "string", short: "o" },
			bank: { type: "string", multiple: true },
			agency: { type: "string" },
			qsf: { type: "boolean" },
			map: { type: "string" },
			ddi: { type: "string" },
			access: { type: "string" },
			"tag-message": { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
}

/** As compilers write it, so editors and CI annotate it: `error`, `warning`, `note`. */
const LEVEL: Readonly<Record<Severity, string>> = {
	hole: "error",
	error: "error",
	warning: "warning",
	info: "note",
};

/** A 1-based line and column (UTF-16 units, as editors count) of an offset. */
export function lineCol(
	source: string,
	offset: number,
): { readonly line: number; readonly col: number } {
	const before = source.slice(0, offset);
	const lines = before.split("\n");
	return { line: lines.length, col: (lines.at(-1)?.length ?? 0) + 1 };
}

/** One finding as a line: `path:line:col: level: message [code]`; a hole says "to fill in". */
export function findingLine(
	path: string,
	source: string,
	ranges: Readonly<Record<string, Range>>,
	f: Finding<string>,
): string {
	const { line, col } = lineCol(source, locate(f, ranges)[0]);
	const what = f.severity === "hole" ? "to fill in" : f.code;
	return `${path}:${line}:${col}: ${LEVEL[f.severity]}: ${f.message} [${what}]`;
}

/**
 * A bank at its tag. One in the workspace's own repository is read from this clone (no
 * network, and no credentials for a private repository), any other from GitHub. Every
 * command reads a pin through here, so they all agree.
 */
async function readPin(
	io: Io,
	a: RemoteAddress,
	own: OwnRepository | undefined,
): Promise<RemoteBank> {
	if (
		own === undefined ||
		`${a.owner}/${a.repo}`.toLowerCase() !== own.repository
	)
		return io.readRemote(a);
	const read = await io.readRemote(a, own.path);
	// A shallow checkout has no tags: say where the tag was looked for, and how to get it.
	return read.kind === "unavailable"
		? {
				...read,
				reason: `${read.reason} This workspace's own tags are read from its clone (${own.path}): if \`${a.ref}\` is on GitHub, fetch it with \`git fetch --tags\`, or check out with \`fetch-depth: 0\` in CI.`,
			}
		: read;
}

/** Each workspace in another repository its instruments use, read once at its tag, by key. */
const readRemotes = async (
	files: Readonly<Record<string, string>>,
	io: Io,
	own: OwnRepository | undefined,
): Promise<Record<string, RemoteBank>> =>
	Object.fromEntries(
		await Promise.all(
			remotesOf(files).map(
				async (a): Promise<[string, RemoteBank]> => [
					a.key,
					await readPin(io, a, own),
				],
			),
		),
	);

/** The workspace in `dir`, checked: every file's findings in path order, then a count. */
async function checkWorkspace(
	dir: string,
	strict: boolean,
	io: Io,
): Promise<number> {
	let files: Readonly<Record<string, string>>;
	try {
		files = await readWorkspace(dir);
	} catch (e) {
		io.err(
			`Can't read the workspace at ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
		);
		return USAGE_ERROR;
	}
	// Workspaces in other repositories, each read once at its tag; one that can't be says why on its use.
	const remote = await readRemotes(files, io, await io.ownRepository(dir));
	const ws = workspaceOf(files, { remote });
	// Each file as the workspace has it: its findings, its text, and its ranges.
	const checked: {
		readonly path: string;
		readonly findings: readonly Finding[];
		readonly ranges: Readonly<Record<string, Range>>;
		/** A YAML file read as nothing: noted, in its place among the others. */
		readonly ignored?: true;
	}[] = [];
	for (const [path, findings] of Object.entries(ws.bank.findings))
		checked.push({
			path,
			findings,
			ranges:
				ws.bank.questions[path]?.ranges ?? ws.bank.schemes[path]?.ranges ?? {},
		});
	for (const [path, { instrument }] of Object.entries(ws.instruments))
		checked.push({
			path,
			findings: instrument.findings,
			ranges: instrument.ranges,
		});
	// The root is always there, so "nothing here" is nothing read, whatever else there is.
	const read = readIn(ws.bank) + Object.keys(ws.instruments).length;
	if (read === 0) {
		io.err(nothingIn(dir));
		return USAGE_ERROR;
	}
	for (const path of ws.ignored)
		checked.push({ path, findings: [], ranges: {}, ignored: true });
	const counts = { incomplete: 0, warnings: 0, findings: 0 };
	for (const { path, findings, ranges, ignored } of checked.sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	)) {
		// Said as compilers note it, at the file's start; a note about the layout, not a
		// finding in a file, so it isn't counted among them.
		if (ignored) {
			io.out(
				`${join(dir, path)}:1:1: note: QREtools ignores this file: it isn't in questions/<folder>/, a shared folder or instruments/. [ignored]\n`,
			);
			continue;
		}
		// As the user named the folder, so a problem matcher finds the file from here.
		for (const f of findings)
			io.out(`${findingLine(join(dir, path), files[path] ?? "", ranges, f)}\n`);
		const s = status(findings);
		counts.findings += findings.length;
		if (s.kind === "incomplete") counts.incomplete += 1;
		else if (s.kind === "advice" && s.worst === "warning") counts.warnings += 1;
	}
	io.err(
		`${read} files, ${counts.findings} findings: ${counts.incomplete} with something to fill in or fix, ${counts.warnings} with warnings.\n`,
	);
	return counts.incomplete > 0 || (strict && counts.warnings > 0)
		? PROBLEMS
		: OK;
}

/**
 * The workspace's questions' DDI: every question's items, keyed once. Refused, with reasons and nothing
 * written, when it would be wrong: no declared agency, two items under one identity, or
 * a document the official schema rejects. Holes don't refuse it: they leave elements out.
 * Shared items no question uses aren't in it. Written as `write` makes it: JSON, or its
 * codebook.
 */
async function exportBank(
	bank: Bank,
	output: string | undefined,
	io: Io,
	/** How the document is written: as JSON, or as a codebook. */
	write: (document: DdiDocument) => Rendered,
): Promise<number> {
	// Each question's items, made as an instrument brings them.
	const sources = Object.keys(bank.questions)
		.sort()
		.map((path): readonly [string, readonly Item[]] => {
			const ev = bank.questions[path];
			return [
				path,
				ev === undefined ? [] : questionItems(ev.draft, bank, path),
			];
		});
	const document = documentOf(sources.flatMap(([, items]) => items));
	const refusal = exportRefusal(
		{
			...(bank.agency !== undefined && { agency: bank.agency }),
			// Only the findings that refuse are read: an access level that can't be trusted.
			findings: Object.values(bank.findings).flat(),
			collisions: collisions(sources),
		},
		await validate(document),
	);
	if (refusal?.kind === "noAgency") {
		io.err(
			"Not exported: the workspace has no DDI agency. Add an `agency:` line to workspace.yaml.\n",
		);
		return PROBLEMS;
	}
	const incomplete = Object.entries(bank.findings).filter(
		([, findings]) => status(findings).kind === "incomplete",
	).length;
	if (incomplete > 0)
		io.err(
			`${incomplete} files have something to fill in or fix. The DDI leaves out what's missing; \`qretools check\` lists it.\n`,
		);
	if (refusal !== undefined) return refused(refusal, io);
	return emit(write(document), output, io);
}

/**
 * The column maps a build copies (`maps/<instrument>-ddi-<source>.columns.json`, by file
 * name), checked against the instruments it builds (their DDI as written, by name): a
 * line for each map it refuses (not named as a map, no such instrument, not readable as
 * its source), and a warning for each made from another DDI than this build's. That one
 * is still copied: an instrument's new DDI exists only once it's merged, and a fielded
 * survey's map stays with the release it was fielded from.
 */
function mapsChecked(
	maps: Readonly<Record<string, string>>,
	ddis: ReadonlyMap<string, Rendered>,
): {
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
} {
	const errors: string[] = [];
	const warnings: string[] = [];
	for (const [file, text] of Object.entries(maps)) {
		const named = MAP_NAME.exec(file);
		const instrument = named === null ? undefined : file.slice(0, named.index);
		const source = named?.[1] ?? "";
		const ddi = instrument === undefined ? undefined : ddis.get(instrument);
		const opened = mapOf(source, text);
		const problem =
			instrument === undefined
				? "a file in maps/ is a column map, named `<instrument>-ddi-<source>.columns.json`."
				: ddi === undefined
					? `this workspace builds no instrument \`${instrument}\` (instruments/${instrument}.yaml).`
					: opened.kind === "unreadable"
						? opened.reason
						: undefined;
		if (problem !== undefined) {
			errors.push(`${file}: error: ${problem} [build-map]`);
			continue;
		}
		const made = opened.kind === "read" ? opened.map.ddi : undefined;
		if (made !== undefined && made !== digestOf(ddi?.text ?? ""))
			warnings.push(
				`${file}: warning: made from the DDI ${made}, not the one this build wrote for \`${instrument}\`. ${
					source === "qsf"
						? `If the survey isn't fielded yet, make it again with \`qretools qsf-map\` from this build's ${instrument}.json. Keep a fielded survey's map as it is.`
						: "If it should read this DDI, make it again with the workspace's own tool in tools/."
				} [build-map-ddi]`,
			);
	}
	return { errors, warnings };
}

/**
 * `qretools build [dir]`: the workspace as committed at HEAD, each file at the version its
 * first-parent history gives (`versionsOf`), exported as `export` does to `out/ddi.json`;
 * and each instrument to `out/instruments/<name>.json`, with its Qualtrics survey
 * (`<name>.qsf`), or a warning where Qualtrics can't run it. It never makes a column map
 * (`qsf-map` does, once the survey is fielded): it copies those committed in `maps/`
 * (`mapsChecked`). Uncommitted changes are left out, and said to be.
 */
async function build(
	dir: string,
	out: string,
	message: string | undefined,
	io: Io,
): Promise<number> {
	const read = await io.readHistory(dir);
	if (read.kind === "unavailable") {
		io.err(`Can't build ${dir}: ${read.reason}\n`);
		return USAGE_ERROR;
	}
	if (read.uncommitted)
		io.err(
			`${dir} has uncommitted changes. They aren't built, as they have no version yet.\n`,
		);
	const versions = versionsOf(read.history);
	const bank = bankOf(
		Object.fromEntries(
			Object.entries(read.files).filter(([p]) => instrumentAt(p) === undefined),
		),
		versions,
	);
	if (readIn(bank) === 0) {
		io.err(nothingIn(dir));
		return USAGE_ERROR;
	}
	// Its instruments, each released whole at its version and read against the banks it
	// pins: its own repository's from this clone, others' from GitHub. All are checked
	// before anything is written, so a refused build writes nothing.
	const remote = await readRemotes(read.files, io, await io.ownRepository(dir));
	const { instruments } = workspaceOf(read.files, { remote, versions });
	let blocked = false;
	for (const [path, one] of Object.entries(instruments))
		for (const f of releaseFindings(one)) {
			io.err(
				`${findingLine(join(dir, path), read.files[path] ?? "", one.instrument.ranges, f)}\n`,
			);
			blocked = true;
		}
	if (blocked) {
		io.err(
			"Not built: an instrument is released only when it's complete and reads every bank at a tag this workspace has locked.\n",
		);
		return PROBLEMS;
	}
	for (const [path, { instrument }] of Object.entries(instruments)) {
		const refusal = exportRefusal(instrument, await validate(instrument.ddi));
		if (refusal === undefined) continue;
		io.err(`${join(dir, path)}:\n`);
		return refused(refusal, io);
	}
	// Each instrument's DDI as written, so a map's digest is checked against these bytes.
	const ddis = new Map(
		Object.entries(instruments).map(([path, { instrument }]) => [
			instrumentAt(path) ?? path,
			asJson(instrument.ddi),
		]),
	);
	const maps = mapsChecked(read.maps, ddis);
	for (const line of maps.errors)
		io.err(`${join(dir, WORKSPACE.maps)}${sep}${line}\n`);
	if (maps.errors.length > 0) {
		io.err(
			"Not built: every file in maps/ is copied beside its instrument's DDI, so each must be a column map of an instrument this workspace builds.\n",
		);
		return PROBLEMS;
	}
	const code = await exportBank(bank, join(out, "ddi.json"), io, asJson);
	if (code !== OK) return code;
	for (const [path, { instrument }] of Object.entries(instruments)) {
		const name = instrumentAt(path) ?? path;
		const file = (ext: string) =>
			join(out, WORKSPACE.instruments, `${name}${ext}`);
		const ddi = asJson(instrument.ddi);
		await emit(ddi, file(".json"), io);
		// Its Qualtrics survey, from that DDI: dated when the instrument last
		// changed (never now), so a commit always builds the same bytes.
		const date = versions[path]?.date;
		const made =
			date === undefined
				? undefined
				: qsfOf(instrument.ddi, {
						name: instrument.draft.name ?? name,
						created: qsfTime(new Date(date)),
						// Of the bytes `<name>.json` holds, so `shasum -a 256` on that file agrees.
						digest: digestOf(ddi.text ?? ""),
						version: pkg.version,
					});
		if (made?.kind !== "made") {
			// A release goes ahead without its survey; one an earlier build left isn't this one.
			await io.removeFile(file(".qsf"));
			io.err(
				`[WARNING] ${join(dir, path)}: not built as a Qualtrics survey. ${
					made === undefined
						? "Its history gives it no date to make the survey with."
						: `${qsfRefusalReason(made.errors)} \`qretools instrument export --qsf\` says what.`
				}\n`,
			);
			continue;
		}
		// Columns the survey's map can't read back, said where the author can fix them.
		for (const f of placeFindings(
			made.findings.filter((f) => f.code === "qsf-unmapped"),
			instrument.places,
		))
			io.err(
				`${findingLine(join(dir, path), read.files[path] ?? "", instrument.ranges, f)}\n`,
			);
		await io.writeFile(file(".qsf"), `${JSON.stringify(made.qsf, null, 2)}\n`);
	}
	// Copied as committed, never made: a map is the workspace's (`qsf-map`, or its own tools).
	for (const line of maps.warnings)
		io.err(`${join(dir, WORKSPACE.maps)}${sep}${line}\n`);
	for (const [file, text] of Object.entries(read.maps))
		await io.writeFile(join(out, WORKSPACE.instruments, file), text);
	// Only for a build that exported: a refused one is no release. Each instrument is listed
	// with its DDI's digest, so a tag reference rebuilds it exactly or refuses.
	if (message !== undefined)
		await io.writeFile(
			message,
			tagMessage(
				versions,
				pkg.version,
				Object.fromEntries(
					Object.keys(instruments).map((path) => [
						path,
						digestOf(ddis.get(instrumentAt(path) ?? path)?.text ?? ""),
					]),
				),
			),
		);
	return OK;
}

/**
 * Why an export was refused, on stderr: the details, then one line. The core decides
 * (`exportRefusal`); these are the CLI's words for it.
 */
function refused(r: Refusal, io: Io): number {
	switch (r.kind) {
		case "noAgency":
			// The instrument's words: the workspace's export says its own before it gets here.
			io.err(
				"Not exported: the instrument has no DDI agency. Add an `agency:` line to its workspace.yaml, or use --agency.\n",
			);
			break;
		case "invalidAgency":
			for (const f of r.findings) io.err(`${f.message}\n`);
			io.err("Not exported: a DDI agency is missing or wrong.\n");
			break;
		case "access":
			// Every question says it; the reason is said once.
			for (const m of new Set(r.findings.map((f) => f.message)))
				io.err(`${m}\n`);
			io.err(
				"Not exported: an access level can't be read, or this workspace doesn't declare one.\n",
			);
			break;
		case "collisions":
			for (const c of r.collisions)
				io.err(`${c.keys.join(" and ")} would share one DDI name, ${c.urn}.\n`);
			io.err("Not exported: two things would share one DDI name.\n");
			break;
		// The CLI always runs the schema first, so `unchecked` can't arrive; were it to,
		// it isn't exported for the schema's sake.
		case "unchecked":
		case "schema":
			for (const p of r.kind === "schema" ? r.problems : [])
				io.err(`${p.message}${p.detail ? ` (${p.detail})` : ""}\n`);
			io.err("Not exported: the DDI doesn't match the official schema.\n");
			break;
		default:
			return r satisfies never;
	}
	return PROBLEMS;
}

/** Compiling the schema takes about 200 ms, so a process does it once, on first use. */
let compiled: Promise<Result<Validator, Finding>> | undefined;

/** The official DDI schema's problems with a document, the schema read beside this module. */
async function validate(document: DdiDocument): Promise<readonly Finding[]> {
	// Imported, not read from disk, so a bundle of the command carries it.
	compiled ??= import("@qretools/core/schema.json", {
		with: { type: "json" },
	}).then(({ default: schema }) => makeValidator(schema));
	const validator = await compiled;
	return validator.ok ? validator.value(document) : [validator.error];
}

/**
 * `qretools instrument check|export <file>`: the instrument read against what it uses,
 * its own workspace (`../`) from the folder above it and another at its tag, or from
 * the directory `--bank` gives for it. Any other local address is refused, as the
 * workspace's own check refuses it (`resolveUses`).
 */
async function instrument(
	args: ReturnType<typeof parse>,
	io: Io,
): Promise<number> {
	const [, command, file, ...extra] = args.positionals;
	if (
		(command !== "check" && command !== "export") ||
		file === undefined ||
		extra.length > 0
	) {
		io.err(`${USAGE}\n`);
		return USAGE_ERROR;
	}
	const stray =
		command === "check"
			? (args.values.output !== undefined && "--output") ||
				(args.values.qsf === true && "--qsf")
			: args.values.strict === true && "--strict";
	if (stray) {
		io.err(
			`\`${stray}\` isn't an option of \`instrument ${command}\`.\n${USAGE}\n`,
		);
		return USAGE_ERROR;
	}
	let source: string;
	try {
		source = (await readFile(file, "utf8")).replaceAll("\r\n", "\n");
	} catch (e) {
		io.err(
			`Can't read ${file}: ${e instanceof Error ? e.message : String(e)}\n`,
		);
		return USAGE_ERROR;
	}
	const given = new Map<string, string>();
	for (const b of args.values.bank ?? []) {
		const eq = b.indexOf("=");
		if (eq <= 0 || eq === b.length - 1) {
			io.err(
				`\`--bank ${b}\` gives an alias its directory as alias=<dir>, such as --bank bank=../bank.\n`,
			);
			return USAGE_ERROR;
		}
		given.set(b.slice(0, eq), b.slice(eq + 1));
	}
	const uses = importsOf(source);
	for (const alias of given.keys())
		if (!uses.some((u) => u.alias === alias)) {
			io.err(
				`\`--bank ${alias}=…\` names nothing this instrument uses (${uses.map((u) => u.alias).join(", ") || "none"}).\n`,
			);
			return USAGE_ERROR;
		}
	// Its workspace's settings, when it's in one: the locks a moved tag is warned against,
	// and where an export locks the tags it read.
	const settingsPath =
		basename(dirname(resolve(file))) === WORKSPACE.instruments
			? join(dirname(file), HERE, ROOT.workspace)
			: undefined;
	const settings =
		settingsPath === undefined
			? undefined
			: await readFile(settingsPath, "utf8").catch(() => undefined);
	const locks = settings === undefined ? {} : locksWritten(settings);
	/** Each bank read at its tag, and the key each alias reads it by. */
	const reads: Record<string, RemoteBank> = {};
	const tagged: Record<string, string> = {};
	const banks: Record<string, BankScope> = {};
	// The repository this instrument's clone is of, once: a pin to it is read from the clone.
	const own = await io.ownRepository(dirname(resolve(file)));
	for (const use of uses) {
		const address: Address =
			use.address === undefined
				? { kind: "invalid", reason: "it has no address." }
				: addressOf(use.address);
		const offline = given.get(use.alias);
		if (address.kind === "invalid" || address.kind === "local") {
			const why =
				address.kind === "invalid"
					? address.reason
					: address.path !== HERE
						? notHere(address.path)
						: offline !== undefined
							? `it's this instrument's own workspace (\`${HERE}\`), read from the folder above. \`--bank\` is only for \`owner/repo@v1\` addresses.`
							: // The folder above is read whole, so it must be a workspace's: the app's rule too.
								basename(dirname(resolve(file))) !== WORKSPACE.instruments
								? `\`${HERE}\` is this instrument's own workspace, and ${file} isn't in a workspace's \`${WORKSPACE.instruments}/\` folder.`
								: undefined;
			if (why !== undefined) {
				io.err(`Can't read \`${use.alias}\`: ${why}\n`);
				return USAGE_ERROR;
			}
		}
		// In another repository, with no directory given for it: read at its tag.
		if (address.kind === "remote" && offline === undefined) {
			const read = await readPin(io, address, own);
			if (read.kind === "unavailable") {
				io.err(`Can't read \`${use.alias}\`: ${read.reason}\n`);
				return USAGE_ERROR;
			}
			reads[address.key] = read;
			tagged[use.alias] = address.key;
			banks[use.alias] = remoteScope(address.key, read);
			continue;
		}
		const dir = offline ?? join(dirname(file), HERE);
		try {
			const files = await readWorkspace(dir);
			banks[use.alias] = scopeOf(files);
		} catch (e) {
			io.err(
				`Can't read \`${use.alias}\` at ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
			);
			return USAGE_ERROR;
		}
	}
	// Its workspace's agency is the instrument's, as in the app and `check`: one per
	// workspace, whichever banks the instrument reads.
	const agency =
		args.values.agency ??
		(settings === undefined ? undefined : agencyWritten(settings));
	// Its own workspace's settings, which imported questions are checked against; outside a
	// workspace, there are none to check, and its inputs take no missing values.
	let host: Host | undefined;
	if (settingsPath !== undefined)
		try {
			host = scopeOf(await readWorkspace(join(dirname(file), HERE))).env;
		} catch (e) {
			io.err(
				`Can't read the workspace of ${file}: ${e instanceof Error ? e.message : String(e)}\n`,
			);
			return USAGE_ERROR;
		}
	const result = instrumentOf(source, {
		banks,
		...(agency !== undefined && { agency }),
		...(host !== undefined && { host }),
	});
	// In a workspace, `check` says a tag no lock holds, as the workspace's check does; an
	// export locks it instead, and says so.
	const moved = [
		...movedTags(tagged, reads, locks),
		...(settingsPath === undefined || command !== "check"
			? []
			: unlockedTags(tagged, reads, locks)),
	];
	if (command === "check") {
		const findings = inDocumentOrder(
			[...result.findings, ...moved],
			result.ranges,
		);
		for (const f of findings)
			io.out(`${findingLine(file, source, result.ranges, f)}\n`);
		const s = status(findings);
		io.err(`${findings.length} findings.\n`);
		return s.kind === "incomplete" ||
			(args.values.strict === true &&
				s.kind === "advice" &&
				s.worst === "warning")
			? PROBLEMS
			: OK;
	}
	const refusal = exportRefusal(result, await validate(result.ddi));
	if (refusal !== undefined) return refused(refusal, io);
	if (status(result.findings).kind === "incomplete")
		io.err(
			"The instrument has something to fill in or fix. The DDI leaves out what's missing; `qretools instrument check` lists it.\n",
		);
	for (const f of moved)
		io.err(`${findingLine(file, source, result.ranges, f)}\n`);
	let code = OK;
	if (args.values.qsf === true)
		code = await exportQsf(file, source, result, args, io);
	else {
		const text = ddiText(result.ddi);
		if (args.values.output === undefined) io.out(text);
		else await io.writeFile(args.values.output, text);
	}
	if (code !== OK) return code;
	// Exported: the tags it read are locked at the commits read, as a build writes its lockfile.
	const next = locksFor(Object.values(tagged), reads, locks);
	if (Object.keys(next).length === 0) return OK;
	if (settingsPath === undefined) {
		io.err(
			`Not locked: ${file} isn't in a workspace's \`${WORKSPACE.instruments}/\` folder, so there's no workspace.yaml to lock its tags in.\n`,
		);
		return OK;
	}
	if (settings === undefined) {
		io.err(
			`Not locked: ${dirname(settingsPath)} has no workspace.yaml that QREtools can read.\n`,
		);
		return OK;
	}
	const locked = withLocks(settings, next);
	if (locked === undefined) {
		io.err(
			`Not locked: ${settingsPath} can't be read (\`qretools check\` says why).\n`,
		);
		return OK;
	}
	// Written whether the DDI went to a file or to stdout: piping it to a file is an export too.
	await io.writeFile(settingsPath, locked);
	for (const [key, commit] of Object.entries(next)) {
		const was = locks[key];
		io.err(
			was === undefined
				? `Locked \`${key}\` at \`${shortCommit(commit)}\` in ${settingsPath}.\n`
				: `[WARNING] Re-locked \`${key}\` at \`${shortCommit(commit)}\` in ${settingsPath}: the tag was moved from \`${shortCommit(was)}\`, so its questions may have changed.\n`,
		);
	}
	return OK;
}

/**
 * The instrument as a Qualtrics survey, made from its DDI: every finding said at its step,
 * and nothing written while any is an error.
 */
async function exportQsf(
	file: string,
	source: string,
	result: ReturnType<typeof instrumentOf>,
	args: ReturnType<typeof parse>,
	io: Io,
): Promise<number> {
	const made = qsfOf(result.ddi, {
		name: result.draft.name ?? basename(file, extname(file)),
		created: qsfTime(new Date()),
		// Of the DDI as `instrument export` writes it, so `shasum -a 256` on that file agrees.
		digest: digestOf(ddiText(result.ddi)),
		version: pkg.version,
	});
	// Not the column map's: `qsf-map` writes it, never this.
	for (const f of placeFindings(
		made.findings.filter((f) => f.code !== "qsf-unmapped"),
		result.places,
	))
		io.err(`${findingLine(file, source, result.ranges, f)}\n`);
	if (made.kind === "refused") {
		io.err(`Not exported: ${qsfRefusalReason(made.errors)}\n`);
		return PROBLEMS;
	}
	const text = `${JSON.stringify(made.qsf, null, 2)}\n`;
	if (args.values.output === undefined) io.out(text);
	else await io.writeFile(args.values.output, text);
	return OK;
}
