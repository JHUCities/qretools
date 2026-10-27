import {
	addressOf,
	bankLocation,
	compact,
	EMPTY_ENV,
	evaluateScheme,
	exampleInstrument,
	FOLDER_PATTERN,
	FOLDER_RULE_TEXT,
	HERE,
	type InstrumentIn,
	instrumentOf,
	instrumentPath,
	instrumentRefAt,
	isRoot,
	locksFor,
	locksWritten,
	type Mention,
	NAME_PATTERN,
	NAME_RULE_TEXT,
	type NamedScheme,
	parseSurface,
	type Range,
	type RemoteBank,
	remoteKeys,
	remotesOf,
	SCHEME_NAME,
	SHAPE,
	saveableName,
	UNNAMED,
	WORKSPACE,
	withLocks,
} from "@qretools/core";
import {
	addInstrumentFill,
	addSpace,
	addVariant,
	applyEdits,
	applyLivelit,
	type Livelit,
	labelledSource,
	livelitsOf,
	locate,
	mentionAt,
	quoteCode,
	rangesOf,
	renameEdits,
	sharedScaleSource,
	textEntrySource,
	withFields,
} from "@qretools/core/editor";
import {
	type BankRef,
	type BankSettings,
	type BranchTarget,
	bankText,
	blobUrl,
	type Change,
	type Failure,
	formatLink,
	type Link,
	parseBank,
	parseLink,
	remoteBankOf,
	sameBank,
} from "@qretools/shell";
import {
	describeChange,
	describeChangeSet,
	describeMove,
	describeSchemeChange,
	describeWorkspaceChange,
	type TagMove,
} from "./commits.js";
import { createEvaluations, type Evaluations } from "./evaluations.js";
import {
	type Activity,
	type AddingBank,
	allFiles,
	type BankEntry,
	type Blob,
	type Cmd,
	detailsOf,
	EMPTY_LOCAL,
	EMPTY_REMOTE,
	type Entry,
	envIn,
	fileOf,
	hasOwnWork,
	type Id,
	type InstrumentEntry,
	instrumentSource,
	isBankEntry,
	type Model,
	type Msg,
	type Naming,
	otherAuthor,
	otherBank,
	ownWork,
	type Path,
	type Question,
	type Remote,
	type RemoteAddress,
	SCHEME_TEMPLATES,
	type SchemeEntry,
	sameName,
	schemeFileNamed,
	signedOut,
	toWork,
} from "./model.js";
import {
	claimOf,
	dependencies,
	rebase,
	remoteBlob,
	remoteOf,
	sliceOf,
	syncOf,
} from "./sync.js";
import { openFolder } from "./tree.js";

type Step = readonly [Model, readonly Cmd[]];

/** Start an effect whose answer must belong to the current intent, not merely arrive late. */
function requested(model: Model, key: string): readonly [Model, number] {
	const request = model.nextRequest;
	return [
		{
			...model,
			nextRequest: request + 1,
			requests: { ...model.requests, [key]: request },
		},
		request,
	];
}

/** Direct reducer tests may omit an identity; effects never do. */
const answers = (
	model: Model,
	key: string,
	request: number | undefined,
): boolean => request === undefined || model.requests[key] === request;

/** An accepted answer no longer owns its request slot. */
function answered(model: Model, key: string): Model {
	const { [key]: _, ...requests } = model.requests;
	return { ...model, requests };
}

/**
 * Pure. Every state change in the app is one case of `step`; this wrapper keeps the
 * address bar naming what is open, and the open file's folder in view. A different
 * file open adds a history entry (so Back works); anything else (a draft gets its
 * path, a file moves) replaces it.
 */
export function update(model: Model, msg: Msg): Step {
	if (stale(model, msg)) return [model, []];
	const lapsed = authFailure(msg);
	const [stepped, cmds] =
		lapsed === undefined ? step(model, msg) : sessionLapsed(model, lapsed);
	const next = settled(revealOpen(model, stepped));
	const before = linkOf(model);
	const after = linkOf(next);
	const linked: Step =
		after === undefined || after === before
			? [next, cmds]
			: [
					next,
					[
						...cmds,
						{ kind: "setLink", hash: after, push: openChanged(model, next) },
					],
				];
	return withRemoteReads(model, msg, linked);
}

/**
 * The banks in other repositories the instruments use and that haven't been asked for,
 * asked for only when that set changes: an edit that leaves the addresses alone asks for
 * nothing. Typing an address waits for a pause; anything else reads at once.
 */
function withRemoteReads(before: Model, msg: Msg, [next, cmds]: Step): Step {
	const wanted = wantedRemote(next);
	if (wanted.length === 0 || keysOf(wanted) === keysOf(wantedRemote(before)))
		return [next, cmds];
	return [
		next,
		[
			...cmds,
			{
				kind: "loadRemoteBanks",
				addresses: wanted,
				now: msg.kind !== "edited",
			},
		],
	];
}

const keysOf = (addresses: readonly RemoteAddress[]): string =>
	addresses.map((a) => a.key).join("\n");

/** The banks in other repositories the workspace's instruments use, not yet asked for. */
function wantedRemote(model: Model): readonly RemoteAddress[] {
	if (model.session.kind !== "connected") return [];
	const sources = Object.fromEntries(
		Object.values(model.local.workspace).flatMap((e) =>
			e.kind === "instrument" ? [[instrumentPath(e.name), e.source]] : [],
		),
	);
	return remotesOf(sources).filter(
		(a) => model.remoteBanks[a.key] === undefined,
	);
}

/** Banks read and found, or being read, are kept across a reload; the rest are read again. */
const keptRemote = (banks: Model["remoteBanks"]): Model["remoteBanks"] =>
	Object.fromEntries(
		Object.entries(banks).filter(([, b]) => b.kind !== "unavailable"),
	);

/**
 * When the open file changes, or moves to another folder (a draft saved, a question
 * moved), its folder opens, once: it is added to `browser.expanded`, so the user can
 * close it again while the file stays open.
 */
function revealOpen(before: Model, after: Model): Model {
	const folder = openFolder(after);
	if (folder === undefined || after.browser.expanded.includes(folder))
		return after;
	const unchanged =
		before.screen.kind === "editing" &&
		after.screen.kind === "editing" &&
		before.screen.id === after.screen.id &&
		openFolder(before) === folder;
	if (unchanged) return after;
	return {
		...after,
		browser: {
			...after.browser,
			expanded: [...after.browser.expanded, folder],
		},
	};
}

function step(model: Model, msg: Msg): Step {
	switch (msg.kind) {
		case "edited":
			return model.screen.kind === "editing"
				? persist([withSource(model, model.screen.id, msg.text), []])
				: [model, []];

		case "themeChosen":
			return model.theme === msg.theme
				? [model, []]
				: [
						{ ...model, theme: msg.theme },
						[{ kind: "applyTheme", theme: msg.theme }],
					];

		case "livelitChosen": {
			// Like typing: only the open file, which the author can edit.
			const q = current(model);
			if (!q || q.id !== msg.id) return [model, []];
			const written = writeLivelit(model, q.id, msg.livelit, msg.value);
			return written === undefined ? [model, []] : persist(written);
		}

		case "fixApplied": {
			// Like typing: only the open file, which the author can edit. A path the text
			// no longer has (it changed since the fix was offered) changes nothing.
			const q = current(model);
			if (!q || q.id !== msg.id) return [model, []];
			const { fix } = msg;
			// A shared entry to create: the name dialog, prefilled, pointed back at this place.
			if (fix.kind === "create") {
				// Only a bank file names a shared one this way.
				if (!isBankEntry(q)) return [model, []];
				const { scheme, name, text, path } = fix.create;
				return [
					{
						...model,
						browser: {
							...model.browser,
							naming: {
								kind: scheme,
								name,
								text,
								purpose: { kind: "create", use: { id: q.id, path } },
							},
						},
					},
					[],
				];
			}
			// A bank for a `uses` entry: its dialog, pointed back at this place.
			if (fix.kind === "bank")
				return [
					{
						...model,
						browser: {
							...model.browser,
							addingBank: {
								text: "",
								use: { id: q.id, path: fix.path },
							},
						},
					},
					[],
				];
			if (fix.kind === "space") {
				const spaced = addSpace(q.source, fix.path, fix.word);
				if (spaced === undefined) return [model, []];
				// Focus follows the fix, as an edit's does: the caret after the new space.
				let at = 0;
				while (spaced[at] === q.source[at]) at++;
				return persist([
					withSource(model, q.id, spaced),
					[{ kind: "revealRange", range: [at + 1, at + 1] }],
				]);
			}
			if (fix.kind === "fill") {
				const added = addInstrumentFill(
					q.source,
					fix.path,
					fix.name,
					fix.question,
				);
				if (added === undefined) return [model, []];
				return persist([
					withSource(model, q.id, added.text),
					[{ kind: "revealRange", range: [added.caret, added.caret] }],
				]);
			}
			// Options made a shared scale: its name dialog, pointed back at the options it
			// replaces.
			if (fix.kind === "share") {
				if (!isBankEntry(q)) return [model, []];
				return [
					{
						...model,
						browser: {
							...model.browser,
							naming: {
								kind: "scale",
								name: "",
								text: "",
								purpose: {
									kind: "create",
									use: { id: q.id, path: fix.path },
									share: true,
								},
							},
						},
					},
					[],
				];
			}
			if (fix.kind === "variant") {
				const added = addVariant(q.source, fix.name);
				// Named there already: the finding goes on the next evaluation.
				if (added.kind === "named") return [model, []];
				// Not a line it can add to (a flow map): the caret goes to `variant_of`, for
				// the author to write it there; a fix never does nothing at all.
				if (added.kind === "unwritable") {
					const at = rangesOf(q.source).variant_of ?? [0, 0];
					return [model, [{ kind: "revealRange", range: [at[0], at[0]] }]];
				}
				return persist([
					withSource(model, q.id, added.text),
					[{ kind: "revealRange", range: [added.caret, added.caret] }],
				]);
			}
			if (fix.kind === "quote") {
				const quoted = quoteCode(q.source, fix.path, fix.code);
				if (quoted === undefined) return [model, []];
				// Focus follows the fix: the caret after the closing quote.
				let at = 0;
				while (quoted[at] === q.source[at]) at++;
				const end = at + JSON.stringify(fix.code).length;
				return persist([
					withSource(model, q.id, quoted),
					[{ kind: "revealRange", range: [end, end] }],
				]);
			}
			const text = applyEdits(q.source, fix.edits);
			if (text === undefined || text === q.source) return [model, []];
			// Focus follows the change into the source (the fix's button goes with its
			// finding): the caret where the earliest edit starts, the same offset before and
			// after the fix, whichever text the editor holds when this runs.
			const ranges = rangesOf(text);
			const at = Math.min(
				...fix.edits.map(
					(e) => locate({ path: e.path, severity: "info" }, ranges)[0],
				),
			);
			return persist([
				withSource(model, q.id, text),
				[{ kind: "revealRange", range: [at, at] }],
			]);
		}

		case "locationClicked": {
			// A click names a place in the document's terms. It becomes a range here,
			// against the text as it is now.
			const q = current(model);
			if (!q) return [model, []];
			const range = locate(msg.target, placesOf(q));
			// A hole at an empty value is a point where the value goes (its own zero-width
			// range, from the parser): offer what can go there (completion writes the space
			// after the colon, never the click). A field not written at all has no range.
			const own = msg.target.range;
			const hole =
				msg.target.severity === "hole" &&
				own !== undefined &&
				own[0] === own[1];
			return [
				model,
				[{ kind: "revealRange", range, ...(hole && { complete: true }) }],
			];
		}

		case "cursorMoved":
			return model.screen.kind === "editing"
				? [
						{ ...model, cursor: { id: model.screen.id, offset: msg.offset } },
						[],
					]
				: [model, []];

		case "hashChanged": {
			const link = parseLink(msg.hash);
			// Our own writes come back as hashchange events; the current link is a no-op.
			if (link === undefined || formatLink(link) === linkOf(model))
				return [model, []];
			return openLink(model, link);
		}

		case "foreignLoaded": {
			const screen = model.screen;
			// A link opened since has moved on; this reply is stale.
			if (
				screen.kind !== "foreign" ||
				screen.branch !== msg.branch ||
				screen.path !== msg.path
			)
				return [model, []];
			if (!msg.result.ok)
				return [
					{
						...model,
						screen: { kind: "blank" },
						failures: [...model.failures, msg.result.error],
					},
					[],
				];
			const { file } = msg.result.value;
			// Their version is exactly the one you started from: open your own copy.
			const own = claimant(model, file.path);
			if (own?.base?.sha === file.sha)
				return [{ ...model, screen: { kind: "editing", id: own.id } }, []];
			const schemes = Object.fromEntries(
				msg.result.value.schemes.map((f) => [
					f.path,
					{ sha: f.sha, text: f.text },
				]),
			);
			return [{ ...model, screen: { ...screen, file, schemes } }, []];
		}

		case "ddiSchemaLoaded":
			return [{ ...model, ddiSchema: msg.result }, []];

		case "listOpened":
			// Going back to the bank also stops waiting to open a link: it would
			// otherwise pull the author away once the bank loads.
			return [
				compact({
					...model,
					screen: { kind: "blank" },
					pendingLink: undefined,
				}),
				[],
			];

		case "definitionRequested": {
			// Only the author's own open question: another author's names resolve against
			// their environment, never this one's.
			const q = current(model);
			if (!q || q.id !== msg.id) return [model, []];
			// An instrument names its banks' files: a question it asks, a universe. Only one
			// that resolves to a bank of this workspace can be followed.
			if (q.kind === "instrument") {
				const read = createEvaluations().instrument(model, q);
				const ref = instrumentRefAt(read.instrument.refs, msg.offset);
				// A name declared in this instrument (an input, a computed value, a roster's
				// row number): the caret goes to its declaration, in place, as a jump within
				// a file makes no history entry in an editor.
				if (ref?.kind === "here")
					return [model, [{ kind: "revealRange", range: ref.declared }]];
				const follow =
					ref === undefined ? undefined : followOf(model, read, ref);
				if (follow === undefined) return [model, []];
				// A bank in another repository opens where it is, on GitHub, in a new tab.
				if (follow.kind === "external")
					return [model, [{ kind: "openExternal", url: follow.url }]];
				const target = follow.file;
				const [opened, cmds] = step(model, {
					kind: "fileOpened",
					id: target.id,
				});
				// A code opens its list at it: the reveal waits for that file's editor.
				return ref?.kind === "code"
					? [
							opened,
							[
								...cmds,
								{
									kind: "revealRange",
									range: locate(
										{ path: ref.at, severity: "info" },
										placesOf(target),
									),
									id: target.id,
								},
							],
						]
					: [opened, cmds];
			}
			if (q.kind !== "question") return [model, []];
			// The names written, resolved or not; the file decides whether there is one.
			const parsed = parseSurface(q.source, EMPTY_ENV);
			const m = mentionAt(parsed.ranges, parsed.mentions, q.source, msg.offset);
			const target =
				m === undefined
					? undefined
					: schemeFileNamed(model.local.schemes, m.scheme, m.name);
			return target === undefined
				? [model, []]
				: step(model, { kind: "fileOpened", id: target.id });
		}

		case "fileOpened":
			return fileOf(model, msg.id)
				? [{ ...model, screen: { kind: "editing", id: msg.id } }, []]
				: [model, []];

		case "filterChanged":
			return [
				{ ...model, browser: { ...model.browser, filter: msg.text } },
				[],
			];

		case "folderToggled": {
			const open = model.browser.expanded.includes(msg.folder);
			const expanded = open
				? model.browser.expanded.filter((f) => f !== msg.folder)
				: [...model.browser.expanded, msg.folder];
			return [{ ...model, browser: { ...model.browser, expanded } }, []];
		}

		case "questionCreated": {
			// A template takes the fields the bank also requires, empty, in their places;
			// a blank question stays blank (its required fields show as holes at the end).
			const [next, id] = add(model, {
				kind: "question",
				source:
					msg.text === "" ? "" : withFields(msg.text, envIn(model).required),
			});
			return persist([{ ...next, screen: { kind: "editing", id } }, []]);
		}

		case "schemeCreateOpened": {
			if (!isRoot(msg.scheme))
				return [
					{
						...model,
						browser: {
							...model.browser,
							naming: {
								kind: msg.scheme,
								name: msg.name ?? "",
								text: "",
								purpose: {
									kind: "create",
									...(msg.use !== undefined && { use: msg.use }),
								},
							},
						},
					},
					[],
				];
			// One file per workspace: open it if it exists, else start it.
			const root = msg.scheme;
			const existing = Object.values(model.local.schemes).find(
				(e) => e.kind === root,
			);
			if (existing)
				return [{ ...model, screen: { kind: "editing", id: existing.id } }, []];
			const [next, id] = add(model, {
				kind: root,
				name: root,
				source: SCHEME_TEMPLATES[root],
			});
			return persist([{ ...next, screen: { kind: "editing", id } }, []]);
		}

		case "schemeRenameOpened": {
			// Only a draft: a saved file's name is its path on GitHub, and other branches'.
			const e = model.local.schemes[msg.id];
			if (!e || isRoot(e.kind) || e.base !== undefined) return [model, []];
			return [
				{
					...model,
					browser: {
						...model.browser,
						naming: {
							kind: e.kind,
							name: e.name,
							text: "",
							purpose: { kind: "rename", id: e.id },
						},
					},
				},
				[],
			];
		}

		case "schemeNameChanged":
		case "schemeTextChanged": {
			const naming = model.browser.naming;
			if (naming === undefined) return [model, []];
			const changed =
				msg.kind === "schemeNameChanged"
					? { ...naming, name: msg.name }
					: { ...naming, text: msg.text };
			return [{ ...model, browser: { ...model.browser, naming: changed } }, []];
		}

		case "instrumentCreateOpened":
			// No example to make (`exampleSource`): nothing opens.
			if (msg.example && exampleSource(model, "example") === undefined)
				return [model, []];
			return [
				{
					...model,
					browser: {
						...model.browser,
						// The example is named already, so Create is one press: `example`, or the
						// first `example_<n>` not taken.
						namingInstrument: msg.example
							? { name: freeExampleName(model), example: true }
							: { name: "" },
					},
				},
				[],
			];

		case "instrumentNameChanged":
			return model.browser.namingInstrument === undefined
				? [model, []]
				: [
						{
							...model,
							browser: {
								...model.browser,
								namingInstrument: {
									...model.browser.namingInstrument,
									name: msg.name,
								},
							},
						},
						[],
					];

		case "instrumentNamingCancelled":
			return [
				{
					...model,
					browser: compact({ ...model.browser, namingInstrument: undefined }),
				},
				[],
			];

		case "instrumentNamingConfirmed": {
			const naming = model.browser.namingInstrument;
			if (
				naming === undefined ||
				instrumentNameProblem(model, naming.name) !== undefined
			)
				return [model, []];
			const source = naming.example
				? exampleSource(model, naming.name)
				: instrumentSource(naming.name);
			if (source === undefined) return [model, []];
			const [added, id] = add(
				{
					...model,
					browser: compact({ ...model.browser, namingInstrument: undefined }),
				},
				{
					kind: "instrument",
					name: naming.name,
					source,
				},
			);
			return persist([{ ...added, screen: { kind: "editing", id } }, []]);
		}

		case "bankAddChanged": {
			const adding = model.browser.addingBank;
			return adding === undefined
				? [model, []]
				: [
						{
							...model,
							browser: {
								...model.browser,
								addingBank: { ...adding, text: msg.text },
							},
						},
						[],
					];
		}

		case "bankAddCancelled":
			return [{ ...model, browser: withoutAdding(model.browser) }, []];

		case "bankAddConfirmed": {
			const adding = model.browser.addingBank;
			if (adding === undefined || bankAddProblem(adding) !== undefined)
				return [model, []];
			const closed = { ...model, browser: withoutAdding(model.browser) };
			// Written where it was asked for, as the `uses` picker writes a bank chosen
			// there, and the caret after it.
			return persist(
				writeLivelit(
					closed,
					adding.use.id,
					adding.use.path,
					adding.text.trim(),
				) ?? [closed, []],
			);
		}

		case "tabShown":
			// The author is back, perhaps from installing the app in another tab.
			return checkingAccess(model, "quiet");

		case "accessCheckRequested":
			return checkingAccess(model, "asked");

		case "accessChecked": {
			// An answer for a session or bank that has changed since is nobody's.
			if (
				model.checking === undefined ||
				model.session.kind !== "connected" ||
				!sameName(model.session.login, msg.login) ||
				!sameBank(bankRefOf(model.settings), msg.repo)
			)
				return [model, []];
			const asked = model.checking === "asked";
			const done: Model = compact({ ...model, checking: undefined });
			// A check nobody asked for fails silently; one asked for says so.
			if (!msg.result.ok)
				return [
					asked
						? { ...done, failures: [...done.failures, msg.result.error] }
						: done,
					[],
				];
			const { login, access } = msg.result.value;
			if (!sameName(login, model.session.login)) return [done, []];
			const session = { ...model.session, access };
			const next: Model = { ...done, session };
			// Only the permission changed: a workspace already loaded stays as it is. One
			// that didn't load (it couldn't be read before) is read now that it can be.
			if (access.kind !== "write" || model.loading.kind !== "failed")
				return [next, []];
			const [loading, request] = requested(next, "workspace");
			return [
				{ ...loading, loading: { kind: "loading" } },
				[
					{
						kind: "loadWorkspace",
						target: targetOf(model.settings, session),
						request,
					},
				],
			];
		}

		case "blockedActionTried":
			// A brief reason passes by itself (the button's tooltip says it); one that stands
			// is explained, with what to do.
			return blockage(model)?.kind === "standing"
				? [{ ...model, browser: { ...model.browser, blockedNotice: true } }, []]
				: [model, []];

		case "blockedNoticeClosed":
			return [
				{
					...model,
					browser: compact({ ...model.browser, blockedNotice: undefined }),
				},
				[],
			];

		case "schemeNamingCancelled":
			return [{ ...model, browser: withoutNaming(model.browser) }, []];

		case "schemeNamingConfirmed": {
			const naming = model.browser.naming;
			if (naming === undefined || namingProblem(model, naming) !== undefined)
				return [model, []];
			const closed = { ...model, browser: withoutNaming(model.browser) };
			if (naming.purpose.kind === "rename") {
				const { id } = naming.purpose;
				const e = model.local.schemes[id];
				if (!e || isRoot(e.kind) || e.base !== undefined) return [closed, []];
				// The instruments' references are read before the rename, while they resolve.
				const inInstruments = instrumentRenames(model, e, naming.name);
				const renamed = withFile(closed, { ...e, name: naming.name });
				const rewritten = inInstruments.reduce(
					(m, [id, text]) => withSource(m, id, text),
					renameReferences(renamed, e.kind, e.name, naming.name),
				);
				return persist([rewritten, []]);
			}
			const written = naming.text.trim() !== "";
			const shape = SHAPE[naming.kind];
			// Shared from a question's options: those, as they are now (checked above).
			const shared =
				naming.purpose.share === true && naming.purpose.use !== undefined
					? sharedScaleSource(
							model.local.questions[naming.purpose.use.id]?.source ?? "",
						)
					: undefined;
			const source =
				shared !== undefined
					? shared
					: !written
						? SCHEME_TEMPLATES[naming.kind]
						: shape === "labelled"
							? labelledSource(naming.text)
							: shape === "text"
								? textEntrySource(naming.text)
								: SCHEME_TEMPLATES[naming.kind];
			// The question that named it now names the file, whatever name was chosen.
			const { use } = naming.purpose;
			const [added, id] = add(closed, {
				kind: naming.kind,
				name: naming.name,
				source,
			});
			const q = use === undefined ? undefined : added.local.questions[use.id];
			const used =
				use === undefined || q === undefined
					? added
					: withSource(
							added,
							q.id,
							applyEdits(q.source, [{ path: use.path, value: naming.name }]) ??
								q.source,
						);
			// A universe or instruction is complete with its text, and a scale made from the
			// question's own options with them: stay on the question. A new scale needs its
			// labels written, so it opens.
			const stay =
				use !== undefined &&
				q !== undefined &&
				(naming.kind !== "scale" || shared !== undefined);
			return persist([
				stay ? used : { ...used, screen: { kind: "editing", id } },
				[],
			]);
		}

		case "deleteRequested": {
			const q = fileOf(model, msg.id);
			if (!q) return [model, []];
			if (model.browser.confirmDelete !== msg.id)
				return [
					{ ...model, browser: { ...model.browser, confirmDelete: msg.id } },
					[],
				];
			const cleared = { ...model, browser: withoutConfirm(model.browser) };
			if (q.base === undefined) return persist([without(cleared, msg.id), []]);
			const as = writable(model);
			if (as === undefined) return [cleared, []];
			return [
				withActivity(cleared, msg.id, { kind: "deleting" }),
				[
					{
						kind: "commit",
						target: targetOf(model.settings, as),
						changes: [
							{
								id: msg.id,
								path: q.base.path,
								expected: q.base.sha,
								text: null,
							},
						],
						message:
							q.kind === "question"
								? describeChange(
										parseSurface(q.base.text, envIn(model)).draft,
										undefined,
									)
								: isBankEntry(q)
									? describeSchemeChange(q.kind, q.name, "delete")
									: describeWorkspaceChange(q, "delete"),
					},
				],
			];
		}

		case "deleteCancelled":
			return [{ ...model, browser: withoutConfirm(model.browser) }, []];

		case "saveRequested": {
			const q = fileOf(model, msg.id);
			const as = writable(model);
			if (!q || as === undefined) return [model, []];
			// A saved file goes back where it was opened. A new question's folder is
			// chosen in a dialog, since git would create a mistyped folder without a word.
			// A new shared file or instrument goes where its kind and name say.
			if (q.base !== undefined) return write(model, as, msg.id, q, q.base.path);
			if (q.kind !== "question") {
				const path = claimOf(q);
				if (path === undefined) return [model, []];
				return taken(model, path, msg.id)
					? [
							refuse(
								model,
								msg.id,
								`\`${path}\` is already used.`,
								"Open the one already there to change it.",
							),
							[],
						]
					: write(model, as, msg.id, q, path);
			}
			// Where it goes is the author's choice: the dialog opens with none chosen.
			const name = saveableName(parseSurface(q.source, envIn(model)).draft);
			if (!name.ok)
				return [refuse(model, msg.id, name.error.message, name.error.hint), []];
			return [
				{
					...model,
					browser: { ...model.browser, saving: { id: msg.id, folder: "" } },
				},
				[],
			];
		}

		case "saveFolderChanged":
			return model.browser.saving === undefined
				? [model, []]
				: [
						{
							...model,
							browser: {
								...model.browser,
								saving: { ...model.browser.saving, folder: msg.folder },
							},
						},
						[],
					];

		case "saveCancelled":
			return [{ ...model, browser: withoutSaving(model.browser) }, []];

		case "saveConfirmed": {
			const saving = model.browser.saving;
			const q =
				saving === undefined ? undefined : model.local.questions[saving.id];
			const as = writable(model);
			if (saving === undefined || q === undefined || as === undefined)
				return [model, []];
			const closed = { ...model, browser: withoutSaving(model.browser) };
			const where = bankLocation(
				parseSurface(q.source, envIn(model)).draft,
				saving.folder,
			);
			if (!where.ok)
				return [
					refuse(closed, saving.id, where.error.message, where.error.hint),
					[],
				];
			// A new draft must not silently overwrite a bank file at that path.
			if (taken(model, where.value.path, saving.id)) {
				return [
					refuse(
						closed,
						saving.id,
						`A question already exists at \`${where.value.path}\`.`,
						"Open that question to change it, or choose another name or folder.",
					),
					[],
				];
			}
			return write(closed, as, saving.id, q, where.value.path);
		}

		case "moveRequested": {
			const q = model.local.questions[msg.id];
			if (q?.base === undefined) return [model, []];
			return [
				{
					...model,
					browser: {
						...model.browser,
						moving: {
							id: msg.id,
							folder: msg.folder ?? folderOfPath(q.base.path),
						},
					},
				},
				[],
			];
		}

		case "moveFolderChanged":
			return model.browser.moving === undefined
				? [model, []]
				: [
						{
							...model,
							browser: {
								...model.browser,
								moving: { ...model.browser.moving, folder: msg.folder },
							},
						},
						[],
					];

		case "moveCancelled":
			return [
				{ ...model, browser: compact({ ...model.browser, moving: undefined }) },
				[],
			];

		case "moveConfirmed": {
			const moving = model.browser.moving;
			const q =
				moving === undefined ? undefined : model.local.questions[moving.id];
			const as = writable(model);
			if (moving === undefined || q?.base === undefined || as === undefined)
				return [model, []];
			const closed = {
				...model,
				browser: compact({ ...model.browser, moving: undefined }),
			};
			const problem = moveProblem(model, q, moving.folder);
			if (problem !== undefined) return [refuse(closed, q.id, problem), []];
			const to = movedPath(q.base.path, moving.folder);
			// A move also saves (owner, 2026-09-29): the working text at the new path,
			// the old path deleted, and the scheme files it names, as a save would.
			const env = envIn(model);
			const subject = describeMove(
				parseSurface(q.base.text, env).draft,
				parseSurface(q.source, env).draft,
				fileName(q.base.path),
				moving.folder,
				q.source !== q.base.text,
			);
			return write(closed, as, q.id, q, to, subject);
		}

		case "committed": {
			const ids = msg.changes.flatMap((c) =>
				c.id === undefined ? [] : [c.id],
			);
			// Saving before signing out: the dialog reports, never a file.
			const leaving = model.browser.signingOut?.phase === "saving";
			const primary = leaving ? undefined : ids[0];
			const idle = ids.reduce<Model>(
				(m, id) => withActivity(m, id, undefined),
				model,
			);
			if (!msg.result.ok) {
				const { failure, seen } = msg.result.error;
				const reported = (m: Model): Model =>
					leaving
						? {
								...m,
								browser: {
									...m.browser,
									signingOut: { phase: "asking", failure },
								},
							}
						: m;
				// GitHub's answer is the ground truth: the app cannot write here (never
				// installed, uninstalled mid-session, or without Contents write).
				if (
					failure.kind === "notInstalled" &&
					model.session.kind === "connected"
				) {
					const blocked: Model = {
						...idle,
						session: { ...model.session, access: { kind: "notInstalled" } },
					};
					return [
						primary === undefined
							? reported(blocked)
							: withActivity(blocked, primary, failed(failure)),
						[],
					];
				}
				// Stale: take what GitHub has at each touched path, so the files show as
				// changed on GitHub, with "Reload from GitHub" to take their version.
				const absorbed =
					seen === undefined
						? idle
						: Object.entries(seen).reduce<Model>(
								(m, [path, blob]) => withGitHub(m, path, blob ?? undefined),
								idle,
							);
				const { local, nextId } = rebase(
					absorbed.local,
					absorbed.remote,
					absorbed.nextId,
				);
				const failedAt =
					primary === undefined
						? reported({ ...absorbed, local, nextId })
						: withActivity(
								{ ...absorbed, local, nextId },
								primary,
								failed(failure),
							);
				return seen === undefined ? [failedAt, []] : persist([failedAt, []]);
			}
			const { shas } = msg.result.value;
			const done = msg.changes.reduce<Model>((m, c) => {
				// A delete with no working file is the old path of a move: GitHub only.
				if (c.text === null)
					return withGitHub(
						c.id === undefined ? m : without(m, c.id),
						c.path,
						undefined,
					);
				const sha = shas[c.path];
				if (sha === undefined) return m;
				const blob = { sha, text: c.text };
				const f = c.id === undefined ? undefined : fileOf(m, c.id);
				// The base becomes what was committed, not what is in the editor now:
				// typing during the save correctly shows as unsaved.
				const based = f
					? withFile(m, { ...f, base: { path: c.path, ...blob } })
					: m;
				return withGitHub(based, c.path, blob);
			}, idle);
			// Everything saveable is saved; drafts without a folder go, as the dialog said.
			return leaving
				? signOut({ ...committed(done), local: EMPTY_LOCAL })
				: persist([committed(done), []]);
		}

		case "reloadRequested": {
			// "Reload from GitHub" takes GitHub's version of the file: its text, or, if
			// GitHub deleted it, its absence. Read at the path the file claims, which covers
			// a draft GitHub also added.
			const q = fileOf(model, msg.id);
			const path = q === undefined ? undefined : claimOf(q);
			if (
				q === undefined ||
				path === undefined ||
				model.session.kind !== "connected"
			)
				return [model, []];
			if (q.base !== undefined && remoteBlob(model.remote, q) === undefined)
				return persist([without(model, msg.id), []]);
			return [
				model,
				[
					{
						kind: "readFile",
						id: msg.id,
						target: readTarget(model, model.session),
						path,
					},
				],
			];
		}

		case "fileReloaded": {
			const q = fileOf(model, msg.id);
			if (!msg.result.ok)
				return [withActivity(model, msg.id, failed(msg.result.error)), []];
			const { path, sha, text } = msg.result.value;
			const reloaded = q
				? withFile(model, { ...q, source: text, base: { path, sha, text } })
				: model;
			return persist([
				withActivity(
					withGitHub(reloaded, path, { sha, text }),
					msg.id,
					undefined,
				),
				[],
			]);
		}

		case "connectRequested": {
			const [chosen, cmds] = withSettings(model, msg.settings);
			// A new connection supersedes every outstanding reply from the former bank.
			const [connecting, request] = requested(
				{ ...chosen, requests: {} },
				"connect",
			);
			return persist([
				{ ...connecting, session: { kind: "connecting" }, failures: [] },
				[
					...cmds,
					{
						kind: "connect",
						repo: {
							owner: msg.settings.owner,
							repo: msg.settings.repo,
							path: msg.settings.path,
						},
						request,
					},
				],
			]);
		}

		case "signInRequested": {
			// Leaving for GitHub and coming back is not leaving the work: no warning.
			const [chosen, cmds] = withSettings(model, msg.settings);
			return persist([
				{
					...chosen,
					session: { kind: "connecting", toGitHub: true },
					failures: [],
				},
				[...cmds, { kind: "signIn", remember: msg.settings.remember }],
			]);
		}

		case "connected": {
			if (!answers(model, "connect", msg.request)) return [model, []];
			const connectedModel = answered(model, "connect");
			// Signed out, whatever the reason: only the author's own work stays.
			if (!msg.result.ok)
				return persist([
					{
						...signedOut(connectedModel),
						session: { kind: "failed", failure: msg.result.error },
					},
					[],
				]);
			{
				const { login, avatarUrl, access, defaultBranch } = msg.result.value;
				const session = {
					kind: "connected" as const,
					login,
					avatarUrl,
					access,
					defaultBranch,
				};
				// This person's work, never another's, before the load: someone else's
				// unsaved work in this tab is set aside, never shown to them or dropped.
				const [theirs, aside] = otherAuthor(connectedModel, login)
					? setAside(
							connectedModel,
							`Unsaved work in this tab belonged to ${connectedModel.author} and was set aside.`,
						)
					: [connectedModel, []];
				const [loading, request] = requested(theirs, "workspace");
				return persist([
					{
						...loading,
						author: login,
						session,
						loading: { kind: "loading" },
					},
					[
						...aside,
						{
							kind: "loadWorkspace",
							target: targetOf(loading.settings, session),
							request,
						},
					],
				]);
			}
		}

		case "workspaceLoaded": {
			if (!answers(model, "workspace", msg.request)) return [model, []];
			const loadedRequest = answered(model, "workspace");
			if (!msg.result.ok)
				return [
					compact({
						...loadedRequest,
						loading: { kind: "failed", failure: msg.result.error } as const,
						pendingLink: undefined,
						updating: undefined,
					}),
					[],
				];
			// Before the author's first save their branch does not exist, and `remote` is
			// the bank they will branch from; the bases stay valid either way, since blob
			// shas are content addresses.
			const { files, from, aheadBy, behindBy, unread } = msg.result.value;
			const proposable = aheadBy > 0;
			const remote = remoteOf(loadedRequest.remote, files);
			const { local, nextId } = rebase(
				loadedRequest.local,
				remote,
				loadedRequest.nextId,
			);
			const loaded: Model = compact({
				...loadedRequest,
				remoteBanks: keptRemote(loadedRequest.remoteBanks),
				local,
				remote,
				nextId,
				loading: { kind: "loaded", from, proposable, behindBy } as const,
				pendingLink: undefined,
				// An update from the default branch ends here, with the branch as it now is.
				updating: undefined,
				// What GitHub wouldn't give as text is left out, said once: this load's
				// notice replaces an earlier load's, and a load with none clears it.
				failures: [
					...loadedRequest.failures.filter((f) => f.hint !== UNREAD_HINT),
					...(unread.length === 0 ? [] : [unreadNotice(unread)]),
				],
			});
			// A link that waited for the bank opens now.
			const [opened, cmds] =
				loadedRequest.pendingLink === undefined
					? [loaded, []]
					: openLink(loaded, loadedRequest.pendingLink);
			return persist([opened, cmds]);
		}

		case "updateFromDefaultRequested": {
			// Only an author's branch that exists can be brought up to date (the first save
			// makes it from the default branch), and never while a write is under way.
			const { session, loading } = model;
			if (
				session.kind !== "connected" ||
				loading.kind !== "loaded" ||
				loading.from !== "branch" ||
				writeBlocked(model) !== undefined
			)
				return [model, []];
			return [
				{ ...model, updating: true },
				[
					{
						kind: "updateFromDefault",
						target: targetOf(model.settings, session),
					},
				],
			];
		}

		case "updatedFromDefault": {
			const done = compact({ ...model, updating: undefined });
			if (model.session.kind !== "connected") return [done, []];
			if (!msg.result.ok)
				return [
					{ ...done, failures: [...done.failures, msg.result.error] },
					[],
				];
			if (msg.result.value === "conflict") {
				const { defaultBranch } = model.session;
				return [
					{
						...done,
						failures: [
							...done.failures,
							{
								kind: "conflict",
								message: `Your branch conflicts with updates to ${defaultBranch}.`,
								hint: "Open a pull request with your changes, and the workspace's owner resolves the conflicts.",
								link: {
									label: "Open a pull request",
									href: compareUrl(model.settings, model.session),
								},
							},
						],
					},
					[],
				];
			}
			// Merged, or nothing to bring: reload, still updating, so no save is checked
			// against the branch as it was before the merge.
			return step(model, { kind: "bankReloadRequested" });
		}

		case "bankReloadRequested": {
			if (model.session.kind !== "connected") return [model, []];
			const [reloading, request] = requested(model, "workspace");
			return [
				{
					...reloading,
					loading: { kind: "loading" },
					remoteBanks: keptRemote(reloading.remoteBanks),
				},
				[
					{
						kind: "loadWorkspace",
						target: targetOf(reloading.settings, model.session),
						request,
					},
				],
			];
		}

		case "disconnected":
			return signOut(model);

		case "signOutRequested":
			// Nothing of the author's own would be left behind: sign out at once.
			return hasOwnWork(model)
				? [
						{
							...model,
							browser: { ...model.browser, signingOut: { phase: "asking" } },
						},
						[],
					]
				: signOut(model);

		case "signOutCancelled":
			return model.browser.signingOut?.phase === "asking"
				? [{ ...model, browser: withoutSigningOut(model.browser) }, []]
				: [model, []];

		case "signOutDiscardConfirmed":
			return model.browser.signingOut?.phase === "asking"
				? signOut({ ...model, local: EMPTY_LOCAL })
				: [model, []];

		// shortcut: a save at sign-out commits directly, without the wait or the locks an
		// instrument's Save writes; `check` warns `unlocked-tag` and the next save repairs it.
		case "signOutSaveConfirmed": {
			const as = writable(model);
			const plan = signOutPlan(model);
			if (
				model.browser.signingOut?.phase !== "asking" ||
				as === undefined ||
				plan.blocked.length > 0 ||
				plan.save.length === 0
			)
				return [model, []];
			return commitFiles(
				{
					...model,
					browser: { ...model.browser, signingOut: { phase: "saving" } },
				},
				as,
				claimedChanges(plan.save),
				plan.save,
			);
		}

		case "exampleHintDismissed": {
			// The banner goes from under its own button: focus returns to the source.
			const at =
				model.screen.kind === "editing" && model.cursor?.id === model.screen.id
					? model.cursor.offset
					: 0;
			return [
				{ ...model, browser: { ...model.browser, exampleHintDismissed: true } },
				[{ kind: "revealRange", range: [at, at] }],
			];
		}

		case "failureDismissed":
			return [
				{
					...model,
					failures: model.failures.filter((_, i) => i !== msg.index),
				},
				[],
			];

		case "persistenceFailed": {
			const message =
				"This browser couldn't keep a recovery copy of your unsaved work.";
			return model.failures.some((f) => f.message === message)
				? [model, []]
				: [
						{
							...model,
							failures: [
								...model.failures,
								{
									kind: "unreadable",
									message,
									hint: "Keep this tab open, and save to your branch before you reload it.",
								},
							],
						},
						[],
					];
		}

		case "remoteBankStarted":
			return [
				{
					...model,
					remoteBanks: { ...model.remoteBanks, [msg.key]: { kind: "loading" } },
				},
				[],
			];

		case "remoteBankLoaded": {
			// Only an answer still awaited: one from before a sign-out or reload is dropped.
			if (model.remoteBanks[msg.key]?.kind !== "loading") return [model, []];
			const read: Model = {
				...model,
				remoteBanks: {
					...model.remoteBanks,
					[msg.key]: remoteBankOf(msg.result),
				},
			};
			// A save waiting for this read goes ahead once nothing it reads is loading,
			// read or not: one that can't be read has its own error, and saves unlocked.
			// A key not asked for yet counts as done: `withRemoteReads` asks for it at once,
			// and the resumed save, finding it still pending, simply waits again.
			const waiting = Object.entries(read.activity).find(
				([, a]) =>
					a.kind === "waiting" &&
					a.keys.every((k) => read.remoteBanks[k]?.kind !== "loading"),
			);
			if (waiting === undefined) return [read, []];
			const id = Number(waiting[0]);
			// Resumed as a plain save: an instrument reaches `write` only from Save (a move is
			// a question's). If instruments ever move, carry the path here.
			return step(withActivity(read, id, undefined), {
				kind: "saveRequested",
				id,
			});
		}

		default:
			return msg satisfies never;
	}
}

/**
 * Emit the commit for a file whose path is settled. A question takes along the unsaved
 * scheme files it names (owner, 2026-09-24); one GitHub also changed stops the save
 * before any request, naming the file to reload. Nothing is sent that GitHub would
 * refuse anyway.
 */
function write(
	model: Model,
	as: Connected,
	id: Id,
	q: Entry,
	path: string,
	subject?: string,
): Step {
	const own = syncOf(q, remoteBlob(model.remote, q));
	const read =
		q.kind === "instrument"
			? createEvaluations().instrument(model, q)
			: undefined;
	// A tag still being read has no commit to lock yet: the save waits for it, so an
	// instrument never lands on the branch without its locks (`remoteBankLoaded` resumes it).
	const reading = Object.values(read?.uses ?? {}).flatMap((u) =>
		u.kind === "pending" ? [u.key] : [],
	);
	if (reading.length > 0)
		return [withActivity(model, id, { kind: "waiting", keys: reading }), []];
	// An instrument locks the tags it reads in the workspace's details, which save with it
	// (`lockedDetails`). A save refused before the commit leaves them untouched; a commit
	// GitHub refuses (stale) leaves the lock as an unsaved change, true to what was read.
	const relocked = read === undefined ? undefined : lockedDetails(model, read);
	const saving =
		relocked === undefined ? model : withDetails(model, relocked.source);
	if (own === "conflict")
		return [
			refuse(
				model,
				id,
				"This was changed both here and on GitHub.",
				"Copy your changes somewhere, reload from GitHub, then save again.",
			),
			[],
		];
	const deps: {
		include: readonly BankEntry[];
		blocked: readonly BankEntry[];
	} =
		q.kind === "question"
			? dependencies(
					model.local,
					model.remote,
					parseSurface(q.source, envIn(model)).mentions,
				)
			: q.kind === "instrument"
				? savedWith(saving, q)
				: { include: [], blocked: [] };
	const [stuck] = deps.blocked;
	if (stuck !== undefined) {
		const name = nameOf(model, stuck);
		// A root file is named by its kind alone: "the workspace details".
		const root = stuck.kind !== "question" && isRoot(stuck.kind);
		// Blocked: changed here and on GitHub (reloading drops the changes here), or deleted there.
		const deleted =
			syncOf(stuck, remoteBlob(model.remote, stuck)) === "deletedOnGitHub";
		const subject = root ? `The ${SCHEME_NAME[stuck.kind]}` : `\`${name}\``;
		const was = root ? "were" : "was";
		const open = root
			? `Open the ${SCHEME_NAME[stuck.kind]}`
			: `Open \`${name}\``;
		const it = root ? "them" : "it";
		return [
			refuse(
				model,
				id,
				deleted
					? `${subject} ${was} deleted on GitHub.`
					: `${subject} ${was} changed both here and on GitHub.`,
				deleted
					? `${open} and reload ${it}${root ? "" : ", or stop using it here"}, then save again.`
					: `${open}, copy your changes somewhere, reload ${it} from GitHub, then save again.`,
			),
			[],
		];
	}
	// Saved somewhere else than its base (a move): the old path goes in the same commit.
	const moved: Change[] =
		q.base !== undefined && q.base.path !== path
			? [{ path: q.base.path, expected: q.base.sha, text: null }]
			: [];
	// The file being saved comes first: a refused commit reports on `changes[0]`.
	return commitFiles(
		saving,
		as,
		[changeOf(q, path), ...claimedChanges(deps.include), ...moved],
		[q, ...deps.include],
		// Only the locks changed: say so, not that the instrument did.
		subject ??
			(relocked !== undefined && own === "inSync" && q.kind === "instrument"
				? `Lock the tags instrument ${q.name} reads`
				: undefined),
		relocked?.moved,
	);
}

/** A bank file's name as its author wrote it: a question's own, or the shared file's. */
const nameOf = (model: Model, f: BankEntry): string =>
	f.kind === "question"
		? (parseSurface(f.source, envIn(model)).draft.name ?? UNNAMED)
		: f.name;

/**
 * What saving an instrument takes along, so it reads on the branch as it reads here:
 * each bank file it names (an asked question, a universe) that is a draft or has
 * unsaved changes, and each asked question's own unsaved shared files. That goes
 * further than a question's save, because the instrument's DDI is built from its
 * questions' shared files: an unsaved scale changes what the instrument means. Only
 * what is named is taken: never every unsaved file of a bank, and never the missing
 * values or the select-all coding by default, as for a question. The workspace details
 * go along when the instrument reads another repository's bank: they hold the tags'
 * locks, which saving writes. Not yet followed: a bank name in a condition, or an
 * input's shared scale (`refs` doesn't hold them).
 */
export function instrumentDependencies(
	model: Pick<Model, "local" | "remote" | "remoteBanks">,
	read: InstrumentIn,
	/** The names a question writes: the view passes its kept evaluations', `update` reads afresh. */
	mentionsOf: (q: Question) => readonly Mention[],
): { include: readonly BankEntry[]; blocked: readonly BankEntry[] } {
	const claims = new Map<Path, BankEntry>();
	for (const f of [
		...Object.values(model.local.questions),
		...Object.values(model.local.schemes),
	]) {
		const at = claimOf(f);
		if (at !== undefined) claims.set(at, f);
	}
	const include = new Map<Id, BankEntry>();
	const blocked = new Map<Id, BankEntry>();
	const consider = (f: BankEntry): void => {
		const sync = syncOf(f, remoteBlob(model.remote, f));
		if (sync === "draft" || sync === "unsaved") include.set(f.id, f);
		else if (sync === "conflict" || sync === "deletedOnGitHub")
			blocked.set(f.id, f);
	};
	const details = detailsOf(model.local.schemes);
	if (
		details !== undefined &&
		Object.values(read.uses).some((u) => u.kind !== "local")
	) {
		consider(details);
		// Saving locks the tags it reads there, so they go along even when saved.
		if (!blocked.has(details.id) && lockedDetails(model, read) !== undefined)
			include.set(details.id, details);
	}
	for (const ref of read.instrument.refs) {
		// A name declared in the instrument itself is no bank file to take along.
		if (ref.kind !== "bank") continue;
		const use = read.uses[ref.alias];
		if (use?.kind !== "local") continue;
		const f = claims.get(ref.path);
		if (f === undefined) continue;
		consider(f);
		if (f.kind !== "question") continue;
		const own = dependencies(model.local, model.remote, mentionsOf(f));
		for (const s of own.include) include.set(s.id, s);
		for (const s of own.blocked) blocked.set(s.id, s);
	}
	return { include: [...include.values()], blocked: [...blocked.values()] };
}

/**
 * What saving an instrument writes into the workspace's details: each tag it reads,
 * locked at the commit read (`locksFor`), so the lock lands on the branch with it, and a
 * moved tag's new lock is a change review sees (and its commit message warns of). The
 * details start from their template when there are none. Undefined when nothing
 * changes, or the details can't be written into (their own findings say why).
 */
export function lockedDetails(
	model: Pick<Model, "local" | "remoteBanks">,
	read: InstrumentIn,
): { readonly source: string; readonly moved: readonly TagMove[] } | undefined {
	const source =
		detailsOf(model.local.schemes)?.source ?? SCHEME_TEMPLATES.workspace;
	const locks = locksWritten(source);
	const reads: Record<string, RemoteBank> = {};
	for (const [key, r] of Object.entries(model.remoteBanks))
		if (r.kind !== "loading") reads[key] = r;
	const next = locksFor(Object.values(remoteKeys(read.uses)), reads, locks);
	if (Object.keys(next).length === 0) return undefined;
	const text = withLocks(source, next);
	if (text === undefined) return undefined;
	return {
		source: text,
		moved: Object.entries(next).flatMap(([key, to]) => {
			const from = locks[key];
			return from === undefined ? [] : [{ key, from, to }];
		}),
	};
}

/** The workspace's details as `source`: their working copy, or a new one when there are none. */
function withDetails(model: Model, source: string): Model {
	const details = detailsOf(model.local.schemes);
	return details === undefined
		? add(model, { kind: "workspace", name: "workspace", source })[0]
		: withSource(model, details.id, source);
}

/**
 * An instrument's dependencies read afresh, as `update` must (it can't reach the view's
 * caches): pure, and its caches end with this call. The bank's environment once.
 */
function savedWith(
	model: Model,
	e: InstrumentEntry,
): { include: readonly BankEntry[]; blocked: readonly BankEntry[] } {
	const evaluations = createEvaluations();
	return instrumentDependencies(
		model,
		evaluations.instrument(model, e),
		(q) => evaluations.get(q, evaluations.env(model)).symbols.mentions,
	);
}

/** What saving an instrument also saves, as its header says it: "consent", "shared scale yes_no". */
export const instrumentAlsoSaves = (
	deps: { include: readonly BankEntry[] },
	/** A question's name as the view has it read. */
	questionName: (q: Question) => string,
): readonly string[] =>
	deps.include.map((f) =>
		f.kind === "question"
			? questionName(f)
			: isRoot(f.kind)
				? SCHEME_NAME[f.kind]
				: `${SCHEME_NAME[f.kind]} ${f.name}`,
	);

/**
 * Where a name in a bank of another repository is, on GitHub at the commit it was read
 * at, so the page shows exactly the text the app does, whatever the tag names later;
 * at the tag the instrument names when no commit is known (a read without one).
 * Undefined for a name in a bank of this workspace.
 */
export function externalUrl(
	read: InstrumentIn,
	ref: { readonly alias: string; readonly path: string },
	remoteBanks: Model["remoteBanks"],
): string | undefined {
	// A code is followed into its list as a name is into its file.
	if (read.uses[ref.alias]?.kind !== "remote") return undefined;
	const written = read.instrument.draft.uses.find(
		(u) => u.alias === ref.alias,
	)?.address;
	const address = written === undefined ? undefined : addressOf(written);
	if (address?.kind !== "remote") return undefined;
	// The read, never the lock: a moved tag's lock names text the app isn't showing.
	const bank = remoteBanks[address.key];
	const commit = bank?.kind === "files" ? bank.at?.commit : undefined;
	return blobUrl(
		address,
		commit ?? address.ref,
		// In that repository, under the folder its workspace is in.
		address.path === "" ? ref.path : `${address.path}/${ref.path}`,
	);
}

/**
 * Where a bank file an instrument names leads: GitHub, for a bank in another repository;
 * else the working file of this workspace that holds it; or nowhere (a bank that didn't
 * load). One answer for Cmd-click, F12 and the outline's links, so they can't disagree.
 */
export type Follow =
	| { readonly kind: "external"; readonly url: string }
	| { readonly kind: "file"; readonly file: BankEntry };

export function followOf(
	model: Pick<Model, "local" | "remoteBanks">,
	read: InstrumentIn,
	ref: { readonly alias: string; readonly path: string },
): Follow | undefined {
	const url = externalUrl(read, ref, model.remoteBanks);
	if (url !== undefined) return { kind: "external", url };
	const use = read.uses[ref.alias];
	const file =
		use?.kind === "local" ? bankFileClaiming(model, ref.path) : undefined;
	return file === undefined ? undefined : { kind: "file", file };
}

/** The working bank file that claims a workspace path, if any. */
function bankFileClaiming(
	model: Pick<Model, "local">,
	path: Path,
): BankEntry | undefined {
	return [
		...Object.values(model.local.questions),
		...Object.values(model.local.schemes),
	].find((f) => claimOf(f) === path);
}

/** Writing a working file at a path: expected at its base when that is the path, else not there yet. */
const changeOf = (f: Entry, path: Path): Change => ({
	id: f.id,
	path,
	expected: f.base?.path === path ? f.base.sha : null,
	text: f.source,
});

/** Changes for files whose path is settled: saved ones and scheme files (kind and name give it). */
const claimedChanges = (files: readonly Entry[]): Change[] =>
	files.flatMap((f) => {
		const at = claimOf(f);
		return at === undefined ? [] : [changeOf(f, at)];
	});

/**
 * One commit of a change set: each working file marked as saving, the message from
 * the first file with the others listed.
 */
function commitFiles(
	model: Model,
	as: Connected,
	changes: readonly Change[],
	files: readonly Entry[],
	/** The first file's line, when the caller has a better one than `messageOf` (a move). */
	subject?: string,
	/** Tags the commit re-locks because they were moved: its message warns of each. */
	movedTags: readonly TagMove[] = [],
): Step {
	const busy = changes.reduce<Model>(
		(m, c) =>
			c.id === undefined ? m : withActivity(m, c.id, { kind: "saving" }),
		model,
	);
	const [first, ...others] = files;
	return [
		busy,
		[
			{
				kind: "commit",
				target: targetOf(model.settings, as),
				changes,
				message: describeChangeSet(
					subject ?? (first === undefined ? "" : messageOf(model, first)),
					others.map((e) => messageOf(model, e)),
					movedTags,
				),
			},
		],
	];
}

/**
 * What signing out does with the author's own work: saved questions and shared files
 * with unsaved changes, and new shared files (their path follows from kind and name),
 * are saved in one commit; question drafts can't be (their folder is a choice) and are
 * discarded; anything GitHub also changed or deleted blocks the save until reloaded.
 */
export function signOutPlan(model: Model): {
	readonly save: readonly Entry[];
	readonly discard: readonly Question[];
	readonly blocked: readonly Entry[];
} {
	const save: Entry[] = [];
	const discard: Question[] = [];
	const blocked: Entry[] = [];
	for (const f of allFiles(model.local).filter(ownWork)) {
		if (f.kind === "question" && f.base === undefined) {
			discard.push(f);
			continue;
		}
		const sync = syncOf(f, remoteBlob(model.remote, f));
		if (sync === "conflict" || sync === "deletedOnGitHub") blocked.push(f);
		else if (sync === "draft" || sync === "unsaved") save.push(f);
	}
	return { save, discard, blocked };
}

/** Signed out: only the author's own work stays, and the credentials are forgotten. */
function signOut(model: Model): Step {
	return persist([
		{ ...signedOut(model), session: { kind: "anonymous" } },
		[{ kind: "forgetToken" }],
	]);
}

/**
 * The work in hand leaves this tab: kept in the browser's storage and said once, never
 * dropped. Clean copies of the bank's files are simply forgotten (a load brings them back).
 */
function setAside(model: Model, message: string): Step {
	const cleared: Model = compact({
		...model,
		local: EMPTY_LOCAL,
		remote: EMPTY_REMOTE,
		remoteBanks: {},
		activity: {},
		screen: { kind: "blank" } as const,
		cursor: undefined,
		author: undefined,
	});
	if (!hasOwnWork(model)) return [cleared, []];
	return [
		{
			...cleared,
			failures: [
				...model.failures,
				{
					kind: "refused",
					message,
					hint: "A copy is kept in this browser (`qretools.work.aside`). QREtools can't open it yet.",
				},
			],
		},
		[{ kind: "setAside", work: toWork(model) }],
	];
}

/**
 * Settings chosen on the sign-in page: kept as the default for new tabs. Work belongs
 * to its bank, so choosing another sets this tab's work aside rather than carry it there.
 */
function withSettings(model: Model, settings: BankSettings): Step {
	const [kept, cmds] = otherBank(model, settings)
		? setAside(
				model,
				`Unsaved work in this tab for ${bankText(model.settings)} was set aside.`,
			)
		: [model, []];
	// A link waiting for another bank than the one chosen on the form is dropped, and
	// taken out of the address first: sign-in saves the address to come back to, and
	// would bring it back to be refused once this bank loads. A link to the chosen
	// bank still opens after signing in.
	const pending = model.pendingLink;
	const linked = pending === undefined ? undefined : parseBank(pending.repo);
	const elsewhere =
		linked !== undefined && !(linked.ok && sameBank(linked.value, settings));
	return [
		compact({
			...kept,
			settings,
			...(elsewhere && { pendingLink: undefined }),
		}),
		[
			...(elsewhere ? [{ kind: "clearLink" } as const] : []),
			...cmds,
			{ kind: "saveSettings", settings },
		],
	];
}

/** The app declined before any request: say so on the file. */
const refuse = (model: Model, id: Id, message: string, hint?: string): Model =>
	withActivity(model, id, failed(compact({ kind: "refused", message, hint })));

/**
 * The commit message for saving a file: what changed in a question, or which scheme file.
 * `envIn` runs uncached here, re-reading the scheme files (a few milliseconds, only on
 * the save and delete paths). `update` is pure and cannot reach the view's cache; do
 * not thread one in to save those milliseconds.
 */
function messageOf(model: Model, q: Entry): string {
	if (!isBankEntry(q))
		return describeWorkspaceChange(q, q.base === undefined ? "add" : "update");
	if (q.kind !== "question")
		return describeSchemeChange(
			q.kind,
			q.name,
			q.base === undefined ? "add" : "update",
		);
	const env = envIn(model);
	return describeChange(
		q.base === undefined ? undefined : parseSurface(q.base.text, env).draft,
		parseSurface(q.source, env).draft,
	);
}

/**
 * A reply saying the author is no longer signed in (the token was refused, or could
 * not be renewed), whichever command it answers. Other failures are ordinary.
 */
function authFailure(msg: Msg): Failure | undefined {
	const failure =
		msg.kind === "connected" ||
		msg.kind === "accessChecked" ||
		msg.kind === "workspaceLoaded" ||
		msg.kind === "fileReloaded" ||
		msg.kind === "foreignLoaded" ||
		msg.kind === "remoteBankLoaded"
			? msg.result.ok
				? undefined
				: msg.result.error
			: msg.kind === "committed"
				? msg.result.ok
					? undefined
					: msg.result.error.failure
				: undefined;
	return failure?.kind === "auth" ? failure : undefined;
}

/**
 * The sign-in has ended: one rule, whatever command noticed. The session says so and
 * offers to sign in again, the stored credentials are forgotten (so a dead token is not
 * retried on every load), and nothing waits on GitHub any more. Working copies stay.
 */
function sessionLapsed(model: Model, failure: Failure): Step {
	return persist([
		{ ...signedOut(model), session: { kind: "failed", failure } },
		[{ kind: "forgetToken" }],
	]);
}

/**
 * A reply from GitHub that no longer has a session to land in: sent before a sign-out,
 * it would bring the bank's files back into a signed-out browser. And a connection
 * answers only while one is being made.
 */
function stale(model: Model, msg: Msg): boolean {
	const out =
		model.session.kind === "anonymous" || model.session.kind === "failed";
	switch (msg.kind) {
		case "updatedFromDefault":
		case "committed":
		case "fileReloaded":
		case "foreignLoaded":
		case "remoteBankStarted":
		case "remoteBankLoaded":
			return out;
		case "accessChecked":
			return out;
		case "connected":
			return (
				model.session.kind !== "connecting" ||
				!answers(model, "connect", msg.request)
			);
		case "workspaceLoaded":
			return out || !answers(model, "workspace", msg.request);
		default:
			return false;
	}
}

/** The folder of a question's path: `questions/<folder>/<name>.yaml`. */
export const folderOfPath = (path: Path): string => path.split("/")[1] ?? "";
const fileName = (path: Path): string =>
	(path.split("/").at(-1) ?? path).replace(/\.yaml$/, "");
/** Only the folder changes; the filename stays, whatever unsaved edits say the name is. */
export const movedPath = (path: Path, folder: string): Path =>
	`questions/${folder}/${path.split("/").at(-1) ?? ""}`;

/** Why a bank question cannot move to `folder`, or undefined when it can. */
export function moveProblem(
	model: Model,
	q: Question,
	folder: string,
): string | undefined {
	if (q.base === undefined) return "Save this question before moving it.";
	if (!FOLDER_PATTERN.test(folder)) return FOLDER_RULE_TEXT;
	const to = movedPath(q.base.path, folder);
	if (to === q.base.path) return "It's already in that folder.";
	const sync = syncOf(q, remoteBlob(model.remote, q));
	if (sync === "conflict")
		return "This question was changed both here and on GitHub. Copy your changes somewhere, then reload it from GitHub.";
	if (sync === "deletedOnGitHub") return "This question was deleted on GitHub.";
	if (taken(model, to, q.id)) return `A question is already at \`${to}\`.`;
	return undefined;
}

/**
 * The link to what is open, as the address bar should show it; undefined while not
 * connected (nothing to name a branch by). The branch is the one the file was read
 * from: before the author's first save their own branch does not exist yet, so a link
 * names the default branch, which others can open.
 */
export function linkOf(model: Model): string | undefined {
	// A link being opened keeps its place in the address bar until it resolves, so a
	// link that fails is still there to copy or report.
	if (model.pendingLink !== undefined) return formatLink(model.pendingLink);
	// Before the load, whether the author's own branch exists is unknown: leave the
	// address alone rather than name a branch dishonestly.
	if (model.session.kind !== "connected" || model.loading.kind !== "loaded")
		return undefined;
	const repo = bankText(model.settings);
	const own =
		model.loading.kind === "loaded" && model.loading.from === "default"
			? model.session.defaultBranch
			: ownBranch(model.session.login);
	const { screen } = model;
	if (screen.kind === "foreign")
		return formatLink({ repo, branch: screen.branch, file: screen.path });
	const open = screen.kind === "editing" ? fileOf(model, screen.id) : undefined;
	// A draft has no path on GitHub yet: the link names the branch alone.
	const file = open?.base?.path;
	return formatLink(
		file === undefined ? { repo, branch: own } : { repo, branch: own, file },
	);
}

/**
 * A link to a working file, for an `<a href>`: undefined while nothing names the branch
 * (not connected, not loaded) or for a draft, which is not on GitHub. The same rule as
 * `linkOf`: the branch the file was read from.
 */
export function hrefOf(
	model: Model,
	f: Entry,
	/** A place in it to open at, as a path in its own terms. */
	at?: string,
): string | undefined {
	const branch = linkBranch(model);
	if (branch === undefined || f.base === undefined) return undefined;
	return formatLink({
		repo: bankText(model.settings),
		branch,
		file: f.base.path,
		...(at !== undefined && { at }),
	});
}

/** The branch links to working files name: the one the bank was read from; undefined before the load. */
export function linkBranch(model: Model): string | undefined {
	if (model.session.kind !== "connected" || model.loading.kind !== "loaded")
		return undefined;
	return model.loading.from === "default"
		? model.session.defaultBranch
		: ownBranch(model.session.login);
}

/** Whether a different file is open: a navigation, which the browser should record. */
const openChanged = (a: Model, b: Model): boolean =>
	a.screen.kind !== b.screen.kind ||
	(a.screen.kind === "editing" &&
		b.screen.kind === "editing" &&
		a.screen.id !== b.screen.id) ||
	(a.screen.kind === "foreign" &&
		b.screen.kind === "foreign" &&
		(a.screen.branch !== b.screen.branch || a.screen.path !== b.screen.path));

/** The working file that holds a path on the author's branch, if any. */
const claimant = (model: Model, path: Path): Entry | undefined =>
	allFiles(model.local).find((f) => f.base?.path === path);

/**
 * Open a link. Your own branch (or the default branch before your first save) opens
 * your local copy at once; viewing never waits for the load, only writing does.
 * Another branch shows that author's version, read only, unless it is exactly the
 * version you started from. What cannot be resolved yet waits for the bank.
 */
/**
 * Where each place in a file is, by path: each kind of file names its places by its own
 * reading of the YAML (an instrument's don't depend on its banks).
 */
function placesOf(f: Entry): Readonly<Record<string, Range>> {
	return f.kind === "instrument"
		? instrumentOf(f.source, { banks: {} }).ranges
		: rangesOf(f.source);
}

/** Open your own copy `f` from a link, at the place it names, if any. */
function openOwn(model: Model, f: Entry, at: string | undefined): Step {
	const opened = compact({
		...model,
		screen: { kind: "editing", id: f.id } as const,
		pendingLink: undefined,
	});
	if (at === undefined) return [opened, []];
	// The file's editor isn't drawn yet: the reveal names the file, and waits for it.
	const range = locate({ path: at, severity: "info" }, placesOf(f));
	return [opened, [{ kind: "revealRange", range, id: f.id }]];
}

function openLink(model: Model, link: Link): Step {
	const repo = bankText(model.settings);
	// One bank: GitHub's names ignore case, a folder's doesn't.
	const linked = parseBank(link.repo);
	if (!linked.ok || !sameBank(linked.value, model.settings)) {
		// Until a bank is open, a link to another bank is where to sign in: the form
		// offers its repository, and the link opens once that bank has loaded.
		if (model.session.kind !== "connected")
			return [{ ...model, pendingLink: link }, []];
		return [
			refused(
				model,
				`This link is to ${link.repo}, but you're signed in to ${repo}.`,
				`Sign out, then sign in to ${link.repo} to open it.`,
			),
			[],
		];
	}
	const loaded = model.loading.kind === "loaded";
	const session =
		model.session.kind === "connected" ? model.session : undefined;
	const ownBranches = session
		? [
				ownBranch(session.login),
				...(loaded &&
				model.loading.kind === "loaded" &&
				model.loading.from === "default"
					? [session.defaultBranch]
					: []),
			]
		: [];
	const own = link.file === undefined ? undefined : claimant(model, link.file);
	// Your own copy answers a link to your own branch at once, even before the load;
	// any other branch (the default one included) waits, since whose version it is
	// cannot be known until their blob is.
	if (own !== undefined && ownBranches.includes(link.branch))
		return openOwn(model, own, link.at);
	if (!loaded || session === undefined)
		return [{ ...model, pendingLink: link }, []];
	// The bank's version is where your copy started, never someone else's: a link to the
	// default branch (one written before your first save, say) opens your copy too.
	if (own !== undefined && link.branch === session.defaultBranch)
		return openOwn(model, own, link.at);
	if (ownBranches.includes(link.branch))
		return link.file === undefined
			? [{ ...model, screen: { kind: "blank" } }, []]
			: [
					refused(
						model,
						`\`${link.file}\` isn't on ${link.branch}.`,
						`\`${link.file}\` may have been moved, renamed or deleted.`,
					),
					[],
				];
	if (link.file === undefined) return [model, []];
	// Their shared files come with it, as their branch has them.
	return [
		{
			...model,
			screen: { kind: "foreign", branch: link.branch, path: link.file },
		},
		[
			{
				kind: "readAt",
				target: { ...targetOf(model.settings, session), branch: link.branch },
				path: link.file,
			},
		],
	];
}

/** What marks the unread notice among the failures, so a later load replaces it. */
const UNREAD_HINT = "GitHub only sends files that are text and not too large.";

/** Files of the workspace GitHub wouldn't give as text: left out of the load, named. */
const unreadNotice = (
	unread: readonly { readonly path: string; readonly reason: string }[],
): Failure => ({
	kind: "unreadable",
	message:
		unread.length === 1
			? `\`${unread[0]?.path}\` couldn't be read, so it's left out.`
			: `${unread.length} files couldn't be read, so they're left out.`,
	hint: UNREAD_HINT,
	detail: unread.map((u) => `${u.path}: ${u.reason}`).join("\n"),
});

/** A link the app declined to open: said once, in the failures. */
const refused = (model: Model, message: string, hint?: string): Model => ({
	...model,
	failures: [
		...model.failures,
		compact({ kind: "refused" as const, message, hint }),
	],
});

/**
 * Whether a path is already GitHub's or another working file's. A changed file
 * deleted on GitHub keeps its base, so it still claims its path though `remote` no
 * longer has it.
 */
const taken = (model: Model, path: Path, self?: Id): boolean =>
	path in model.remote.questions ||
	path in model.remote.schemes ||
	allFiles(model.local).some((f) => f.id !== self && claimOf(f) === path);

/**
 * Why a name cannot be given to a new scheme file, or undefined when it can. The
 * dialog shows it as the author types; `update` refuses on it.
 */
/**
 * Why a new instrument can't have this name, or undefined: the name is its file's
 * (`instruments/<name>.yaml`), compared ignoring case, as two files differing only in
 * case collide in a checkout on macOS or Windows and read as one to an author.
 */
/** `example`, or the first `example_<n>` no instrument has. */
function freeExampleName(model: Model): string {
	for (let n = 1; ; n++) {
		const name = n === 1 ? "example" : `example_${n}`;
		if (instrumentNameProblem(model, name) === undefined) return name;
	}
}

/**
 * Where the example instrument's questions are, as a new workspace's template ships
 * them. A folder name with meaning, as `banks/example` was, against the rule that no
 * file's name means anything: tolerated because it only gates an onboarding offer.
 * Nothing is read differently for being there, and the offer still depends on the
 * example reading cleanly (`exampleSource`), so a folder of other questions offers none.
 */
const EXAMPLE_QUESTIONS = "questions/example/";

/** Whether the workspace has a question saved among the example's (`EXAMPLE_QUESTIONS`). */
const hasExampleQuestions = (model: Pick<Model, "remote">): boolean =>
	Object.keys(model.remote.questions).some((p) =>
		p.startsWith(EXAMPLE_QUESTIONS),
	);

/**
 * The example instrument named `name`, asking its own workspace's questions (`../`);
 * undefined where there is none to make: no example questions saved, or a workspace
 * the example doesn't read in (its questions changed). `update` evaluates the bank
 * afresh; the view passes the app's kept evaluations.
 */
export function exampleSource(
	model: Pick<Model, "local" | "remote">,
	name: string,
	evaluations: Evaluations = createEvaluations(),
): string | undefined {
	return hasExampleQuestions(model)
		? exampleInstrument(name, HERE, evaluations.scope(model))
		: undefined;
}

export function instrumentNameProblem(
	model: Pick<Model, "local" | "remote">,
	name: string,
): string | undefined {
	if (name === "") return "Give it a name.";
	if (!NAME_PATTERN.test(name)) return NAME_RULE_TEXT;
	const key = instrumentPath(name).toLowerCase();
	const taken =
		Object.values(model.local.workspace).some(
			(e) => e.kind === "instrument" && sameName(e.name, name),
		) ||
		Object.keys(model.remote.workspace).some((p) => p.toLowerCase() === key);
	return taken ? `An instrument named \`${name}\` already exists.` : undefined;
}

export function schemeNameProblem(
	model: Model,
	kind: NamedScheme,
	name: string,
	self?: Id,
): string | undefined {
	if (name === "") return "Give it a name.";
	if (!NAME_PATTERN.test(name)) return NAME_RULE_TEXT;
	return Object.values(model.local.schemes).some(
		(e) => e.kind === kind && e.name === name && e.id !== self,
	)
		? `A ${SCHEME_NAME[kind]} named \`${name}\` already exists.`
		: undefined;
}

const withoutSigningOut = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, signingOut: undefined });

const withoutSaving = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, saving: undefined });

const withoutConfirm = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, confirmDelete: undefined });

/**
 * The blocked notice is open only while a standing blockage holds: once it lifts (the app
 * was installed, the workspace loaded) the notice goes with it, so a later blockage never
 * opens a dialog nobody asked for.
 */
const withoutStaleNotice = (model: Model): Model =>
	model.browser.blockedNotice === true && blockage(model)?.kind !== "standing"
		? {
				...model,
				browser: compact({ ...model.browser, blockedNotice: undefined }),
			}
		: model;

/** No check of what the app may do outlives the session it was asked for. */
const withoutStaleCheck = (model: Model): Model =>
	model.checking !== undefined && model.session.kind !== "connected"
		? compact({ ...model, checking: undefined })
		: model;

/** What holds of every Model, whatever the step: nothing left over from a state that ended. */
const settled = (model: Model): Model =>
	withoutStaleNotice(withoutStaleCheck(model));

const bankRefOf = (settings: Model["settings"]): BankRef => ({
	owner: settings.owner,
	repo: settings.repo,
	path: settings.path,
});

/**
 * Ask GitHub what the app may do now, while a permission blocks writing (the app isn't
 * installed, or read access only: GitHub may say otherwise since), unless it is being
 * asked already: one check at a time, and a press while a quiet one is in flight only
 * makes it said.
 */
function checkingAccess(model: Model, how: "quiet" | "asked"): Step {
	const { session } = model;
	if (session.kind !== "connected" || session.access.kind === "write")
		return [model, []];
	if (model.checking !== undefined)
		return [how === "asked" ? { ...model, checking: "asked" } : model, []];
	return [
		{ ...model, checking: how },
		[
			{
				kind: "checkAccess",
				repo: bankRefOf(model.settings),
				login: session.login,
			},
		],
	];
}

const withoutAdding = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, addingBank: undefined });

const withoutNaming = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, naming: undefined });

/**
 * What stops the name dialog's answer: the name rule, or another shared file of the
 * kind with that name. A file being renamed does not stand in its own way.
 */
export function namingProblem(
	model: Model,
	naming: Naming,
): string | undefined {
	const self = naming.purpose.kind === "rename" ? naming.purpose.id : undefined;
	return (
		schemeNameProblem(model, naming.kind, naming.name, self) ??
		shareProblem(model, naming)
	);
}

/**
 * Why a question's options can't be made the shared scale being named, as they are now
 * (they changed since the dialog opened): nothing is written then, rather than a scale
 * without them that the question would name in their place.
 */
function shareProblem(model: Model, naming: Naming): string | undefined {
	const { purpose } = naming;
	if (purpose.kind !== "create" || purpose.share !== true) return undefined;
	const q =
		purpose.use === undefined
			? undefined
			: model.local.questions[purpose.use.id];
	return q !== undefined && sharedScaleSource(q.source) !== undefined
		? undefined
		: "These responses can't be shared as they are. Each option must be a plain `code: label` line, with no title, variable or note.";
}

/** Every question in this tab that names the file by its old name now names the new one. */
function renameReferences(
	model: Model,
	scheme: NamedScheme,
	from: string,
	to: string,
): Model {
	let next = model;
	for (const q of Object.values(model.local.questions)) {
		const edits = renameEdits(q.source, scheme, from, to);
		const text = edits.length === 0 ? undefined : applyEdits(q.source, edits);
		if (text !== undefined && text !== q.source)
			next = withSource(next, q.id, text);
	}
	return next;
}

/**
 * Each instrument here that names the shared file `e`, with its text once every name
 * of it reads `<alias>.<to>`: a universe on a step, a scale an input is on. Read while
 * the old name still resolves; an instrument naming it becomes an unsaved change, as a
 * question does.
 */
function instrumentRenames(
	model: Model,
	e: SchemeEntry,
	to: string,
): readonly (readonly [Id, string])[] {
	const path = claimOf(e);
	const evaluations = createEvaluations();
	return Object.values(model.local.workspace).flatMap((i) => {
		if (i.kind !== "instrument") return [];
		const read = evaluations.instrument(model, i);
		const hits = read.instrument.refs.filter((r) => {
			if (r.kind !== "bank") return false;
			const use = read.uses[r.alias];
			return use?.kind === "local" && r.path === path;
		});
		if (hits.length === 0) return [];
		// From the end, so each range still points where it did.
		const text = [...hits]
			.sort((a, b) => b.range[0] - a.range[0])
			.reduce(
				(src, r) =>
					`${src.slice(0, r.range[0])}${r.kind === "bank" ? r.alias : ""}.${to}${src.slice(r.range[1])}`,
				i.source,
			);
		return [[i.id, text] as const];
	});
}

const current = (model: Model): Entry | undefined =>
	model.screen.kind === "editing" ? fileOf(model, model.screen.id) : undefined;

/**
 * Why nothing can be changed on GitHub right now: brief (the app is doing something, and
 * it will pass) or standing (it stays until someone acts), with what to do about it.
 * A reason puts its cause first, so a line cut short keeps the useful half, and says
 * what is true of every write (save, move, delete, update), as it is shown at each.
 */
export type Blockage =
	| { readonly kind: "brief"; readonly reason: string }
	| {
			readonly kind: "standing";
			readonly reason: string;
			/** What the author can do, in a sentence; absent when the fix says it all. */
			readonly hint?: string;
			/**
			 * What the app can offer: installing the GitHub App (then asking GitHub again),
			 * asking GitHub again (someone may have granted access), or loading again.
			 */
			readonly fix: "install" | "recheck" | "retryLoad";
	  };

/**
 * What blocks writing now, or undefined when nothing does. One rule for `update`, which
 * refuses on it, and for the view, which says it at the buttons and in the top bar.
 * Before this session's load, `remote` is only "last known, as of each base": a file
 * in conflict would look merely unsaved, so a save then would act on a wrong picture.
 */
export function blockage(model: Model): Blockage | undefined {
	const brief = (reason: string): Blockage => ({ kind: "brief", reason });
	if (model.session.kind !== "connected") return brief("Sign in to save");
	if (model.session.access.kind === "readOnly")
		return {
			kind: "standing",
			reason:
				"You can only read this repository, so you can't change this workspace",
			hint: "Ask its owner for write access, then try again.",
			fix: "recheck",
		};
	if (model.session.access.kind === "notInstalled")
		return {
			kind: "standing",
			reason:
				"The QREtools app isn't installed on this repository, so this workspace can't be changed",
			hint: "Install the QREtools app on this repository, then try again.",
			fix: "install",
		};
	if (model.updating)
		return brief(`Bringing ${model.session.defaultBranch} into your branch…`);
	if (model.loading.kind === "failed")
		return {
			kind: "standing",
			reason: "The workspace didn't load, so it can't be changed",
			fix: "retryLoad",
		};
	if (model.loading.kind !== "loaded") return brief("Loading the workspace…");
	// One commit at a time: two in flight naming the same file would make the second
	// look stale for a save that worked. Commits to one branch are serial anyway. A save
	// waiting for its tags holds the rest, as one in flight does.
	for (const a of Object.values(model.activity))
		if (a.kind === "waiting")
			return brief(
				`Reading ${a.keys.map((k) => `\`${k}\``).join(", ")} before saving…`,
			);
	if (
		Object.values(model.activity).some(
			(a) => a.kind === "saving" || a.kind === "deleting",
		)
	)
		return brief("Saving…");
	return undefined;
}

/**
 * Whether the open instrument offers the example beside it: the author's first
 * instrument, never saved, the workspace holding no other here or on GitHub, and a
 * question saved among the example's (`EXAMPLE_QUESTIONS`), until they dismiss the
 * offer. The cheap half of the rule: the view also asks that the example reads there
 * (`exampleSource`). Not tied to its text, so typing never takes the offer away.
 */
export const offersExample = (
	model: Pick<Model, "local" | "remote" | "browser">,
	id: Id,
): boolean => {
	const e = model.local.workspace[id];
	return (
		e?.kind === "instrument" &&
		e.base === undefined &&
		model.browser.exampleHintDismissed !== true &&
		hasExampleQuestions(model) &&
		Object.values(model.local.workspace).every(
			(o) => o.kind !== "instrument" || o.id === id,
		) &&
		!Object.keys(model.remote.workspace).some((p) =>
			p.startsWith(`${WORKSPACE.instruments}/`),
		)
	);
};

/** Why nothing can be written to GitHub right now (`blockage`'s reason), or undefined. */
export const writeBlocked = (model: Model): string | undefined =>
	blockage(model)?.reason;

/**
 * The bank is on its way from GitHub: what this browser holds is only last known, so
 * the sidebar shows the bank's shape rather than stale files. (An open file stays:
 * viewing never waits, only writing does.)
 */
export const bankLoading = (model: Model): boolean =>
	model.session.kind === "connecting" || model.loading.kind === "loading";

/**
 * The top bar's status: what the session is doing, or why nothing can be written.
 * Empty in the steady state (connected, loaded, writable, idle), since the account
 * and the repository already say who and where. A file's inactive write buttons point
 * at it, so whenever `writeBlocked` gives a reason while signed in, this says one
 * (tested); signed out there are no files and no buttons.
 */
export function sessionStatus(model: Model): string | undefined {
	const { session, loading } = model;
	switch (session.kind) {
		// Signed out there is no editor: the sign-in page says what to do, and why.
		case "anonymous":
		case "failed":
			return undefined;
		case "connecting":
			return "Signing in…";
		case "connected":
			return loading.kind === "failed"
				? `The workspace didn't load: ${loading.failure.message.replace(/\.$/, "")}`
				: // What is happening now comes before a standing reason (read only).
					model.screen.kind === "foreign" && model.screen.file === undefined
					? `Loading ${model.screen.path} from ${model.screen.branch}…`
					: // Asked for by the author ("Try again"): said while GitHub answers.
						model.checking === "asked"
						? "Checking with GitHub…"
						: writeBlocked(model);
	}
}

/**
 * GitHub's compare page for the author's branch against the default branch: the pull
 * request form once there is something to propose.
 */
export const compareUrl = (
	settings: BankSettings,
	session: { readonly login: string; readonly defaultBranch: string },
): string =>
	`https://github.com/${settings.owner}/${settings.repo}/compare/${session.defaultBranch}...${encodeURI(ownBranch(session.login))}?expand=1`;

/** The author's own branch: each author works apart and proposes with a pull request. */
const BRANCH_PREFIX = "qretools-";
export const ownBranch = (login: string): string => `${BRANCH_PREFIX}${login}`;
/**
 * Whose own branch this is, or undefined for any other branch. A hyphen, not a slash:
 * the branch reads as one segment of the header's `owner / repo / branch`, and git
 * could not hold a `qretools` ref beside `qretools/…` ones. Logins are letters,
 * digits and single hyphens, so everything after the prefix is the login.
 */
export const branchOwner = (branch: string): string | undefined =>
	branch.startsWith(BRANCH_PREFIX) && branch.length > BRANCH_PREFIX.length
		? branch.slice(BRANCH_PREFIX.length)
		: undefined;

type Connected = Extract<Model["session"], { kind: "connected" }>;

const targetOf = (
	settings: Model["settings"],
	session: Connected,
): BranchTarget => ({
	owner: settings.owner,
	repo: settings.repo,
	path: settings.path,
	branch: ownBranch(session.login),
	defaultBranch: session.defaultBranch,
});

/** Where to read a file: the author's branch, or, before their first save, the bank. */
const readTarget = (model: Model, session: Connected): BranchTarget => {
	const target = targetOf(model.settings, session);
	return model.loading.kind === "loaded" && model.loading.from === "default"
		? { ...target, branch: target.defaultBranch }
		: target;
};

/** Whom to write as, once `writeBlocked` has passed; undefined means it has not. */
const writable = (model: Model): Connected | undefined =>
	writeBlocked(model) === undefined && model.session.kind === "connected"
		? model.session
		: undefined;

const failed = (failure: Failure) => ({ kind: "failed" as const, failure });

/**
 * Replace one working file. Only its own slice is rebuilt: a question never touches
 * `local.schemes`, so the local environment keeps its identity while questions are
 * edited. This and `add`/`without` are the only writers of `local`.
 */
function withFile(model: Model, f: Entry): Model {
	const local = model.local;
	switch (f.kind) {
		case "question":
			return {
				...model,
				local: { ...local, questions: { ...local.questions, [f.id]: f } },
			};
		case "instrument":
			return {
				...model,
				local: { ...local, workspace: { ...local.workspace, [f.id]: f } },
			};
		default:
			return {
				...model,
				local: { ...local, schemes: { ...local.schemes, [f.id]: f } },
			};
	}
}

/**
 * A file's pickers in its text as it is now: a question's fields, the workspace's details. One
 * place, so a choice is always written where its picker is now.
 */
/**
 * The pickers of a file as its text is now. An instrument's are read without its banks:
 * they are the same either way (`instrumentLivelits`), and reading the banks is costly.
 */
function livelitsIn(model: Model, f: Entry): readonly Livelit[] {
	if (f.kind === "instrument")
		return instrumentOf(f.source, { banks: {} }).livelits;
	if (!isBankEntry(f)) return [];
	const env = envIn(model);
	return f.kind === "question"
		? livelitsOf(f.source, parseSurface(f.source, env), env)
		: evaluateScheme(f.kind, f.source, env).livelits;
}

/**
 * `value` written at the picker `livelit` of file `id`, found in its text as it is now,
 * and the caret after it, as focus follows a choice into the source; undefined when that
 * picker isn't there any more.
 */
function writeLivelit(
	model: Model,
	id: Id,
	livelit: string,
	value: string | readonly string[],
): Step | undefined {
	const f = fileOf(model, id);
	const l = f && livelitsIn(model, f).find((x) => x.id === livelit);
	const written = f && l && applyLivelit(f.source, l, value);
	return written === undefined
		? undefined
		: [
				withSource(model, id, written.text),
				[{ kind: "revealRange", range: [written.caret, written.caret] }],
			];
}

/**
 * Why this bank can't be added, or undefined: one on GitHub needs an address in another
 * repository at a version (this workspace's own is chosen from the `uses` picker's list
 * instead).
 */
export function bankAddProblem(adding: AddingBank): string | undefined {
	const text = adding.text.trim();
	if (text === "") return "Write the bank's address.";
	const address = addressOf(text);
	if (address.kind === "invalid") return address.reason;
	return address.kind === "local"
		? "That's this workspace: choose it from the list instead."
		: undefined;
}

function withSource(model: Model, id: Id, source: string): Model {
	const f = fileOf(model, id);
	return f === undefined || f.source === source
		? model
		: withFile(model, { ...f, source });
}

/** Activity lives beside the content, so marking a scale "saving" leaves the environment alone. */
function withActivity(
	model: Model,
	id: Id,
	activity: Activity | undefined,
): Model {
	const { [id]: _, ...rest } = model.activity;
	return {
		...model,
		activity: activity === undefined ? rest : { ...rest, [id]: activity },
	};
}

/** Record what a write, delete or reload told us about the author's branch. */
function withGitHub(model: Model, path: Path, blob: Blob | undefined): Model {
	return { ...model, remote: withBlob(model.remote, path, blob) };
}

/** A save made a commit on the author's branch: it exists now, with something to propose. */
function committed(model: Model): Model {
	return model.loading.kind === "loaded"
		? {
				...model,
				loading: { ...model.loading, from: "branch", proposable: true },
			}
		: model;
}

/** GitHub's copy at one path, set or removed, in the slice the path belongs to. */
function withBlob(remote: Remote, path: Path, blob: Blob | undefined): Remote {
	const slice = sliceOf(path);
	if (slice === undefined) return remote;
	const { [path]: _, ...rest } = remote[slice];
	return {
		...remote,
		[slice]: blob === undefined ? rest : { ...rest, [path]: blob },
	};
}

function without(model: Model, id: Id): Model {
	const { [id]: _q, ...questions } = model.local.questions;
	const { [id]: _s, ...schemes } = model.local.schemes;
	const { [id]: _w, ...workspace } = model.local.workspace;
	const { [id]: _a, ...activity } = model.activity;
	return {
		...model,
		local: {
			questions:
				id in model.local.questions ? questions : model.local.questions,
			schemes: id in model.local.schemes ? schemes : model.local.schemes,
			workspace:
				id in model.local.workspace ? workspace : model.local.workspace,
		},
		activity,
		screen:
			model.screen.kind === "editing" && model.screen.id === id
				? { kind: "blank" }
				: model.screen,
	};
}

type NewFile =
	| Pick<Question, "kind" | "source">
	| Pick<SchemeEntry, "kind" | "name" | "source">
	| Pick<InstrumentEntry, "kind" | "name" | "source">;

function add(model: Model, file: NewFile): [Model, Id] {
	const id = model.nextId;
	return [{ ...withFile(model, { ...file, id }), nextId: id + 1 }, id];
}

/** Every change to what should survive a reload ends with a persist command. */
const persist = ([model, cmds]: Step): Step => [
	model,
	[...cmds, { kind: "persist", work: toWork(model) }],
];
