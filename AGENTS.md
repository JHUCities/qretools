# qretools v2 — agent instructions

Read this before touching anything. It records the decisions made so far, why, and what is deliberately deferred. Keep it current: when a decision here changes, change it here in the same change.

`FEATURES.md` is the backlog: features, issues and tasks raised outside the planned steps. Nothing there is committed to. Decisions live here; candidates live there.

## What this is

A next-generation survey authoring system. The thesis: modern tooling plus ideas from
the cutting edge of programming-language research (Hazel: typed holes, live evaluation,
livelits; Grove: collaborative structure editing) can make writing survey questions to
the latest DDI specification an absolute pleasure, and make survey composition
surprising, delightful, and technologically advanced. Prefer the state of the art.
Name the field and check prior art before designing anything substantial.

The reference survey is the Baltimore Area Survey (Johns Hopkins 21st Century Cities).
Its 2025 codebook is the target shape for question documentation:
https://jhucities.github.io/baltimore-area-survey-data/bas-2025/codebook.html

Vocabulary: in this sociological field, question metadata is called "documentation",
and the compiled documentation of a survey's variables is a "codebook".

## Core tenet: usable for any DDI-conformant question bank (2026-09-24)

This is a general tool, not a BAS tool. Any survey team with a question bank should be
able to use it, and everything it produces must be conformant DDI. The Baltimore Area
Survey and JHU 21st Century Cities are the reference case and the first user, never
the design target. Concretely:

- **Nothing about one bank is a constant.** Agency, repository, bank conventions
  (missing-value codes, the binary scale select-all options are coded on, variable
  naming) are data the bank supplies or settings the user chooses, never literals in
  `src/`. A BAS value may be a default or an example, visibly so.
- **DDI is the contract; the surface language is a convenience.** What is exported
  validates against the official schema, and uses DDI's own mechanisms (schemes,
  managed representations, variables) rather than conventions only BAS would recognise.
- **BAS-shaped views are defaults, not policy.** The codebook preview follows the BAS
  codebook because that is the reference; another team's house style is a view, not a fork.
- When a feature is justified only by BAS ("how BAS publishes it"), say so in the code
  and ask whether it is a bank convention that should become data.

Known departures today are listed in `FEATURES.md` under "Generality".

## Overarching goal: a codebase that is easy to reason about

Above every feature: a well-factored codebase that adopts patterns borrowed from Elm
and other functional languages, so that any part can be understood by reading it.
Concretely:

- **Functional core, imperative shell.** Core functions take values and return values.
  Effects live at the edge and are described as data before they are run.
- **The Elm Architecture in the shell.** One immutable `Model`; a `Msg` union of
  everything that can happen; `update(model, msg) -> [Model, Cmd[]]`; `view(model)`
  renders; a small runtime runs commands and feeds results back as messages. No
  framework hides the loop.
- **Make impossible states unrepresentable.** Discriminated unions over boolean flags;
  a `Draft` with holes rather than a half-valid `Question`; one response domain as a
  tagged union, not three optional fields that must be checked together.
- **Parse, don't validate.** Turn untrusted input into a typed value once, at the
  boundary; downstream code never re-checks.
- **Errors are values.** `Result` and `Findings`, never thrown exceptions, in the core.
- **Small, total, named functions** with explicit inputs; no hidden globals, clocks,
  or randomness in the core; data flow is visible in signatures.

When a shortcut would make the code harder to reason about, take the longer path.

## Three roles, one in scope

1. **Question-maker** (in scope now): drafts survey questions and their documentation.
   Typically students draft, then upload. Scope: Create, Read, Upload, Delete questions,
   elaborated to DDI.
2. **Survey composer** (deferred): composes questions into an instrument with skips,
   variables, loops, randomization. See "Lookahead" below.
3. **Undefined** (deferred).

Storage and auth are deferred until all three roles are hashed out. Do not build them.

**First deliverable is a toy.** Simply CRUD over questions, with a couple of example
questions, enough to see the surface language, the holes, and the DDI output working
end to end. Keep every step small; do not build ahead of that.

## Decisions (settled — do not re-litigate)

- **DDI target is DDI-Lifecycle 4.0** (beta 4 / RC1, model-first, ships an official
  JSON Schema, draft 2020-12). Vendored at `src/ddi/ddi-lifecycle-4.0-beta4.schema.json`.
  No version pinning ceremony: this is a prototype; upgrade when 4.0 is adopted.
  Verified 2026-09-21: 3.3 (2020) is the adopted version; 4.0 entered final review in 2026.
- **Browser-only, local-first.** No server. Everything (parse, check, lint, elaborate,
  validate, render) is a pure function running in the page. The core is TypeScript.
  Python/FastAPI/HTMX/Pydantic were considered and dropped: every server step had a
  browser equivalent, and one parser beats two.
- **Questions are YAML; the YAML is a small surface language that elaborates to DDI.**
  Raw DDI is not hand-writable. The surface says nothing about DDI; `elaborate` does.
- **`../qretools` (the R package) is a reference source only.** Every requirement or
  convention taken from it must be pressure-tested, not inherited.

## Stack (verified state of the art, September 2026)

| Concern | Tool |
|---|---|
| Versions | mise, pinning Node 26 and pnpm |
| Packages | pnpm |
| Types | TypeScript 7 (native compiler, plain `tsc`) |
| Dev and build | Vite 8 (Rolldown) |
| Lint and format | Biome 2 |
| Tests | Vitest |
| Surface schema | Zod 4 (single source of truth; emits JSON Schema for the editor) |
| DDI validation | ajv, draft 2020-12, against the vendored DDI schema |
| Editor | CodeMirror 6, `@codemirror/lang-yaml`, `codemirror-json-schema`, `yaml` |
| UI | React 19, Primer React, Zustand (see the decision below the table) |

**Decided 2026-09-24: React 19 with GitHub's Primer design system and Zustand.** This
reverses the earlier "no UI framework" line. The owner asked for a fuller UI (a file-tree
browser for the bank) from a design system with a funded team behind it. Evaluated with
measured builds: Cloudscape (AWS, broadest, 513 KB gz), Elastic EUI, Primer (GitHub),
Carbon (IBM, the only non-React tree view), Web Awesome, daisyUI, Ark UI. Primer won
because the bank, the login and the students' commits are all GitHub, and Primer's tree
view is the one github.com uses; it is React-only, so React came with it. Zustand holds
the Model: one `dispatch` action runs `update`, sets the Model, executes the returned
Cmds; components subscribe with selectors; the `devtools` middleware names each message
for Redux DevTools. Thunks and any effect outside `update` are forbidden: `update` stays
the only place a state change or an effect is decided. Stack additions: `react`,
`react-dom`, `@primer/react` 38 (CSS modules and tokens, no CSS-in-JS runtime),
`@primer/primitives`, `@primer/octicons-react`, `zustand`, `@vitejs/plugin-react` 6,
`@testing-library/react` with jsdom. CodeMirror stays behind `editor.ts`, wrapped by a
small component that owns its lifecycle and calls `sync`.

## The surface language (role 1)

```yaml
name: nhd_sat
text: How satisfied are you with your neighborhood as a place to live?
intent: Prevalence of overall neighborhood satisfaction; anchor item for the nhd module
concept: neighborhood satisfaction
universe: All respondents
responses:
  1: Very satisfied
  2: Somewhat satisfied
  3: Neither satisfied nor dissatisfied
  4: Somewhat dissatisfied
  5: Very dissatisfied
instruction: Select one
source: DCAS 2018 Q6
```

Required: `name`, `text`, `intent`, and exactly one response domain: `responses`
(code list; add `select: many` for select-all), `number` (`min`, `max`, `unit`,
`decimals`), or `open` (`max_length`). Optional: `concept`, `universe`, `instruction`,
`source`. Agency, ID, Version, URNs are tool-assigned, never typed.

Mapping to DDI-L 4.0: name → QuestionItemName; text → QuestionText (LiteralText);
intent → QuestionIntent; responses → CodeList + Category + CodeDomain; select many →
ResponseCardinality; number → NumericDomain (NumberRange, MeasurementUnit); open →
TextDomain (MaxLength); concept → Concept + ConceptReference; instruction →
Instruction + InterviewerInstructionAttachment; source → BasedOnObject.
`universe` has no direct home on QuestionItem in 4.0 (it attaches via constructs);
emit a Universe item and resolve the link in role 2.

## Decisions recorded from step reviews

- **Response codes are read from the YAML AST in author order, with the author's
  spelling** (`010` stays `010`). JavaScript objects reorder integer-like keys and
  YAML retypes them; a codebook lists options as written. The Zod `responses` record is
  documentation and JSON Schema only.
- **Readers return `Read<T> = { value?, findings }`**, never a threaded mutable
  accumulator: data flow is visible in signatures, and each reader owns its own holes.
- **Immutability is by `readonly` types, not `Object.freeze`.** The compiler is the
  guarantee, as in Elm; deep-freeze fixtures in tests if a runtime check is wanted.
- **`compact()` drops `undefined`** so optional fields are absent, never
  present-and-undefined (`exactOptionalPropertyTypes` is on).
- **Every finding range is clamped to the text**; CodeMirror throws on diagnostics past
  the end of the document.

- **Model, Msg and Cmd are plain data.** No functions, no DOM nodes: a Msg stream that
  can be logged and replayed is the cheapest debugging tool a hand-rolled Elm loop has,
  and step 5 will serialise the Model. The compiled DDI validator therefore lives in
  `mount`'s closure (written only by `exec`, read only by `view`); the Model holds only
  `ddiSchema: loading | ready | failed`.
- **A click names a place in the document's terms (a `Target`: path, severity, optional
  own range); `update` resolves it to a range against the text as it is now.** Ranges
  captured when a pane is drawn go stale, because unchanged panes are kept (to preserve
  preview input state). This was a real bug: wrong selection, and a RangeError.
  `editor.reveal` also clamps, so a click can never throw.
- **`dispatch` is created once by `run` and handed to `mount`.** The editor and static
  controls are built once; `view(model)` takes only the model.
- **The shell is split by whether code holds state.** `panes.ts` is stateless functions
  from core data to elements; `mount.ts` is the only file with hidden state (skeleton,
  editor, validator, memo, change detector) and also runs commands.
- **The verdict on a draft is core policy:** `status(findings)` returns
  `complete | advice | incomplete`; the shell only styles it.
- **Backticks in finding messages mark field names**; the shell renders them as code.
  That is the whole convention.
- **Schema completion is composed, not bundled.** `codemirror-json-schema`'s
  `yamlSchema()` adds its own linter, which would double-report and call holes errors.
  We use its `yamlCompletion`, `yamlSchemaHover` and `stateExtensions`, push our own
  findings with `setDiagnostics` (holes map to CodeMirror's otherwise unused `hint`
  severity), and add `complete.ts` for the cases the package does not cover: a blank
  line, the first key under a parent, an empty enum value.

- **On a Mac, completion opens with Cmd-I or Option-Esc (VS Code's bindings), set in
  `editor.ts`.** macOS often takes Ctrl-Space for input-source switching, and
  CodeMirror's own `Alt-i` cannot fire where Option-I is a dead key (US layout). We do
  not force Option-I: it is how authors type accents ("rôle") in question text. Lesson
  for verification: Playwright's synthetic keys skip the macOS dead-key layer, so an
  Option binding that passes headless can fail on a real keyboard; reproduce with the
  real event shape (`key: "Dead"`, `code: "KeyI"`).

- **Step 6 (surface extensions), 2026-09-23.** `title` and `note` are fields; `legacy`
  is a map kept verbatim, of which only the key names enter the Draft (values are
  never read), and a lint says it is there. `responses` is either an inline map or the
  name of a shared scale; scales are a bank-level value (`Scales`, one file per scale
  with a `labels:` map, named by file) that the shell loads and passes to
  `parseSurface(text, scales)`; an unknown name is a hole, never a crash, and the
  domain records `scale` so previews and elaboration know it is shared. Scale names
  reach the editor as `oneOf` constants on the string branch of the JSON Schema, with
  the labels as their description, so completion shows them; the schema is a value the
  shell pushes with `updateSchema` when the scales change.
- **Select-many is one variable per option**, as BAS publishes it. An option may be a
  map `{ label, title, variable, note }`; its variable is `optionVariable(name, code)`,
  one total function: `variable` if given, else `<name>_<code>`, else undefined while
  `name` is a hole. The settled `<name>_<code>` default describes only 5 of the 188
  option variables in the real bank (157 concatenate with no separator, 26 are
  unrelated to the question name), so `variable` is mandatory syntax and the importer
  writes it wherever the default does not match. DDI: one QuestionItem with a
  CodeDomain and cardinality, plus one `Variable` item per option referencing the
  question, each a CodeDomain on the shared binary scale `yesno01` (0 No, 1 Yes).
  QuestionGrid (matrices) and one QuestionItem per option were rejected.
  **Coupling to record:** the elaborator's binary scale is a core constant emitted under
  the identity `scale-yesno01.codes`; the bank must ship `scales/yesno01.yaml` with
  exactly `0: No`, `1: Yes`, or the two will disagree by name.
- **DDI IDs allow one dot.** Every code list hangs off a base: `<base>.codes`,
  `<base>.cat-i`, `<base>.code-i`; a question's base is its name, a shared scale's is
  `scale-<name>`. The step 2 reviewer had warned about this and the step 6 code
  violated it anyway; the "validates against the official schema" test caught it.
- **`title`/`variable` on an option under `select: one`** get an `ignored-key` warning
  rather than being dropped silently. "Other, specify" stays under `legacy` for now.

- **Step 5 (storage and CRUD), 2026-09-23.** The bank is read and written through a
  storage port (`src/app/storage.ts`) with one adapter, GitHub with a pasted
  fine-grained token (`github.ts`): one GraphQL request loads the whole bank, the
  contents API writes and deletes with the blob sha as a precondition, and a 409/422
  with a sha presented is a *stale* failure with a "Reload from GitHub" action, never a
  merge. The token lives in `mount`'s closure and in session storage (local storage only
  when "remember" is ticked); it never enters the Model or a Msg. `Failure` is a shell
  type: HTTP is not the core's vocabulary. Capability is GitHub's `permissions.push`.
  Questions are keyed by a numeric `Id`; a question's origin is `draft` or
  `bank{path, sha, original}` and "unsaved" is derived, never stored. New drafts file
  under `questions/<prefix>/<name>.yaml` (core `bankPath`); bank files keep the path
  they were opened at. Commit messages come from core `describeChange`.
  Folder-from-name-prefix is an assumption for new drafts only; a bank file that
  becomes a draft again (gone remotely, modified locally) refiles by prefix on its next
  save. A `Failure` of kind `refused` means the app declined before any request was
  made (no valid name; path already taken by a bank question). 409/422 is "stale" only
  when a sha was presented. The list toolbar and the bank form are static controls
  (rebuilding the filter input per keystroke steals the caret). No example drafts are
  seeded: the first run is an empty list with "New from <example>" one click away. `update`
  refuses to save a draft over a bank path that another question occupies. Local
  persistence is a `persist` Cmd debounced in `exec`; the stored value is validated by
  a Zod schema and an unreadable one becomes a failure and is kept aside. `mergeBank`
  (shell, pure, tested) reconciles a loaded bank with local state: unmodified files
  refresh, modified ones stay, gone-and-modified become drafts. The editor resets its
  state when the open question changes. Development writes go to the throwaway
  `sandbox` branch through the branch setting; `main` stays untouched until trusted.

- **The Primer shell (2026-09-24).** `src/app/ui/` holds React components; `store.ts` is
  the Zustand store whose only mutation is `dispatch` (update, setState named by
  `msg.kind`, then the Cmds); `effects.ts` is `exec` plus the shell's only hidden state
  (token, store, validator, persist debouncer, editor handle); `evaluations.ts` is a pure
  cache; `tree.ts` derives the bank tree from the Model, tested without React. The Model
  gained `browser: { filter, expanded, confirmDelete?, settingsOpen }`: the tree is always
  visible so its state outlives the open question, and dialog visibility is Model state,
  not component state. Effective folder expansion is derived (opened by the user, or
  holding the open question, or any folder while filtering). Unnamed drafts show under
  "(unfiled)", last: an assumption. Bank files keep the folder of their path. The
  CodeMirror wrapper (`EditorPane.tsx`) owns only the editor's lifecycle and registers
  its handle with the effects for `revealRange`; `editor.ts` gained `destroy()` and
  reads Primer's tokens for the hole colour and font. Component state is limited to
  transient form input (the Bank dialog's fields; the token goes to the effects, never a
  Msg). Vite plugin: `@vitejs/plugin-react` 6 (oxc-based); `plugin-react-oxc` does not
  install against Vite 8. Measured: the bundle grew from 368 KB to 559 KB gzipped.

- **Templates, not examples, start a new question (2026-09-24).** `src/templates/*.yaml`
  are named for the shape they show (single choice, shared scale, number, select all
  that apply), never for a question in the bank: a template carrying a real variable
  name produced a draft that collided with the bank's copy and could not be saved. Every
  required field is empty, so a new question opens as a list of holes. `src/examples/`
  stays as test fixtures.
- **Where a new question goes is chosen at save, not derived silently.** Saving a draft
  opens a dialog with the topic folder prefilled from the name's prefix
  (`folderOf`), editable, showing the resulting path; it says when the folder is new
  ("saving creates it") and refuses a path a bank question already holds. Only on
  confirm is the write emitted. Core `bankLocation(draft, folder?)` returns
  `{ folder, name, path }` and validates both. The filename always follows the name, so
  a question has one identity; the folder is free, which the bank needs
  (`dem_latx` lives in `svy/`). A bank file never asks: it saves back to the path it was
  opened at. Rationale: git creates any missing path, so an unseen folder would
  otherwise be created by a typo without a word.
- **Save commits directly to the branch in the Bank panel**, one commit per save,
  attributed to the token's owner, refused only when the file changed on GitHub since it
  was opened. No review step exists yet; "propose a change" as a pull request is backlog.

- **A key written with no value is a hole, required or not, at every depth (2026-09-24).**
  `title:` with nothing after it, `number: min:` empty, an option's empty `title:`, an
  empty `select:`: all holes, never silently ignored and never type errors, which is what
  they were before in three different ways. The author opened the key, as typing `?`
  opens a hole in Hazel; the hint for an optional one says "fill it in, or remove the
  line". An absent optional key stays a complete value. `opened()` in `read.ts` is the
  one place this is decided. The migrated bank still has `intent` as its only hole.
  The Draft does not yet carry the opened-but-empty distinction (a preview shows the
  fallback, not a hole slot); that remains in FEATURES.md.

## Principles from PL research (how features are judged)

- **Total error localization.** Every draft, however broken, elaborates. Missing or
  wrong fields are *findings* with a path into the document (severity: hole, error,
  warning, info). Never show a parse-error wall; the `yaml` package is error-tolerant.
- **Live evaluation.** Every keystroke re-renders: the question as the respondent sees
  it, the codebook entry as BAS publishes it, the DDI JSON, and the findings.
- **Livelits (later).** Inline widgets at holes, e.g. a scale picker inside an empty
  `responses:`.
- **Lints encode the craft.** From the practitioners' notes: state what you want to
  learn (intent); same stimulus for everyone; options mutually exclusive and
  exhaustive; interpretability; expect 10–20% extra candidate questions. Mechanical
  checks (duplicate labels, select-many without a residual option, double-barreled
  text, missing intent) are severity-graded advice, not blockers.
- A draft you cannot save is a draft you lose. Save broken drafts verbatim.

## Lookahead (not to build yet; role 1 must not preclude it)

- **Surveys are a real DSL, not YAML.** Prior art: the Language Workbench Challenge's
  QL. A Lezer grammar (incremental, error-tolerant) gives holes; types come from the
  question bank (code list → enum, select many → set, number → numeric); live
  evaluation is a respondent simulator; static checks include reachability and
  comparing each question's declared `universe` with the universe inferred from path
  conditions. DDI-L 4.0 already has Sequence, IfThenElse, Loop, ComputationItem,
  StatementItem, QuestionConstruct; conditions go in CommandCode.
- **Git as the local-first backend.** One file per question/survey on a forge
  (GitHub) via its REST API with hash preconditions
  (compare-and-swap). Login is OAuth to the forge. Upload is a pull request; merge is
  promotion to the bank and gives provenance for free. Git prevents silent overwrites,
  not simultaneous edits; a bad merge is just a document with holes. Git LFS only for
  media. Real-time co-editing later via Yjs; Grove is the principled endgame.

- **Datastore findings, verified 2026-09-21 (not yet a decision).** The BAS team already
  uses a git repo as the datastore: private `JHUCities/baltimore-area-survey` on GitHub,
  in the v1 layout (`banks/questions/<topic>.yml` with about 294 questions across 11
  files, shared `value-labels/`, `banks/modules.yml`, `surveys/bas-2026/design/` with
  candidates and the composed survey). The v1 R package reads it today to build BAS
  2026, so v2 must not write v1 files it cannot round-trip. Field names there have
  drifted (`storage_type` vs `response_type`, `value_labels_name` vs `value_label_id`),
  which is the case for a checking editor. Prior art for a browser app on a forge is the
  git-based CMS (Decap, Sveltia, Keystatic): content as files, login by OAuth, review
  as pull requests. Tested with curl: GitHub's API allows cross-origin calls but its token endpoint does not and still
  requires a client secret, so GitHub needs a small auth proxy or a pasted fine-grained
  token. Storage should be a port in the shell with one adapter per forge.
- **Decided 2026-09-21: the target forge is GitHub, in the JHUCities organisation.**
  Verified the same day with curl: GitHub's API
  accepts browser cross-origin calls, including the preflights for an authorised
  contents PUT and for creating a pull request; its OAuth token endpoint and its
  device-flow endpoint do not, and the token exchange still requires a client secret
  (GitHub "does not distinguish between public and confidential clients"). Sveltia CMS
  lists client-side PKCE for GitHub as unimplemented, waiting on GitHub. So a static
  site needs either a pasted fine-grained token or one small stateless token-exchange
  function. JHUCities already publishes on GitHub Pages. *Proposed, not yet decided:*
  a GitHub App owned by the organisation (fine-grained permissions on the bank repo
  only, 8-hour user tokens, commits attributed to the student), the site on GitHub
  Pages, PKCE plus a roughly 50-line token-exchange function as the single narrow
  exception to "no server", and token paste first because it needs no infrastructure.
  The token never enters the Model: it lives in the shell, and the Model holds only
  `session: anonymous | signingIn | signedIn{login} | failed`.
  **Decided the same day: token paste is the login for now.** The user creates a
  fine-grained personal access token (not a classic one) limited to the bank repository,
  with Contents read and write, Pull requests read and write, and an expiry, and pastes
  it into the app. The GitHub App flow swaps in later behind the same messages.
- **JHED login (JHU single sign-on): considered and declined, 2026-09-21.** The owner
  does not want the tool tied to JHU; GitHub OAuth is enough. The facts agree: JHU's
  identity provider (Shibboleth with OIDC) allows only secret-based clients, so a static
  site could not complete the login; and it proves who someone is at JHU while granting
  nothing on GitHub, so it would have needed a backend that writes to the bank as a bot,
  a real trust boundary holding two secrets. Revisit only if students turn out not to
  have GitHub accounts. The tool stays usable by any survey team with a GitHub repo.
- **Requirement, 2026-09-21: a user who picks GitHub and has access may CRUD the
  question bank through git.** The app offers a choice of store (this browser, or
  GitHub). It implements no authorisation of its own: GitHub decides, and the app
  detects. Verified: `GET /repos/{owner}/{repo}` returns `permissions` for the token's
  user, and **organisation membership alone does not grant write access**: the owner's
  own account is an active JHUCities member with `push: false` on the bank repo. So the
  capability rule is the repository permission: `push` gives full CRUD, `pull` gives a
  read-only bank plus local drafts, neither gives local only. An organisation admin
  grants write, typically through a team. Also verified: one GraphQL request returns
  every file in a folder with its text and blob id, and the GraphQL endpoint accepts
  browser cross-origin calls, so loading a bank is one request. Writes use the contents
  API with the blob id as a precondition, so a stale save is refused, not merged
  silently. Owner, repo, branch and folder are settings, not constants: nothing is
  hard-coded to JHUCities.
- **Notes for role 2 from the step reviews.** `elaborate` returns a whole document;
  an instrument is many questions plus constructs, so split out
  `elaborateItems(draft, agency): Item[]` and call `documentOf` once at the edge
  (concatenating item lists is trivial; merging documents is not). `documentOf`
  silently overwrites on an ID collision, unreachable today, reachable then.
- **Surface-language gaps seen against the BAS codebook (raise with the owner).** BAS
  titles are short curated labels ("WATER QUALITY CONCERN"), and the surface has no
  `label`/title field; the concept stands in. BAS publishes select-all items as one
  binary variable per option ("STEM: OPTION"); we emit one QuestionItem.
- **The DDI agency is `edu.jhu.21cc`** (decided 2026-09-23). It is an explicit input to
  `elaborate`, set in `src/app/model.ts`; the bank's surface files carry no URNs.

## Working rules

- Ask, don't assume; when unattended, choose the reasonable option and record it here.
- Simplest solution for simple problems. Do not add flexibility not yet needed.
- Don't touch unrelated code; surface smells separately.
- Flag uncertainty explicitly; run a small experiment rather than guess.
- Research prior art before building anything substantial, and say so before coding.

## Review gate at every discrete step

Implementation proceeds in discrete steps. Each step is reviewed **before and after**
implementation by a senior-dev review agent (a fresh subagent for the step, given this
file and a written description of the work; the same agent does both passes so it can
revisit its own advice).

**Before.** The reviewer:

1. reads the description of the work;
2. conceptualizes their own implementation independently, before looking at any draft;
3. simplifies that implementation;
4. checks it for consistency with the architectural pattern: **functional core,
   imperative shell**. The core (`src/core/`) is pure: no DOM, no storage, no clocks,
   no randomness, no I/O; it takes values and returns values (drafts, findings, DDI
   documents, render models). The shell (`src/app/`) does the editor, DOM, storage,
   files, and network, and contains no survey policy.

The reviewer then hands the review to the implementing agent, who incorporates it:
reconcile the reviewer's design with the plan, prefer the simpler one, implement.

**After.** The implementing agent sends the resulting code back to the same reviewer.
The reviewer revisits their earlier advice with the benefit of seeing what was built:
which of it held up, which was wrong, and what they did not foresee. After that
reflection they minimize repetition of cant, trite, or bad advice. The point is to
leave room for the two agents to surprise one another, not to re-run a checklist.
The implementing agent incorporates what survives, and records in this file any
disagreement that changes a decision.

Planned steps for role 1: (0) scaffold and layout; (1) core: surface schema and tolerant
parse to Draft + findings; (2) core: elaborate to DDI 4.0 + schema validation;
(3) core: lints and render models; (4) shell: editor with schema completion, live
preview, findings as diagnostics; (5) shell: CRUD, upload, download, DDI export.

Steps 0 to 7 are done (5 last, against the `sandbox` branch).

**Step 8 (decided 2026-09-24): schemes.** Shared elements as DDI models them, one
mechanism: the parser takes an environment of schemes (`parseSurface(text, env)`), a
reference position resolves against its scheme or is a hole, and each scheme gets a
section in the tree with "used by" derived from the loaded questions. Populate all four:
scales (exists), missing-value codes (one bank-level file), universes, instructions.
Syntax decides reference versus prose: a bare identifier is a name, anything else is
text. Concepts and sources stay free text; categories are never surfaced.

**Step 8(a) built (2026-09-24): the core of schemes.** `Env { scales, universes,
instructions, missing }` (`src/core/surface/env.ts`) replaces the bare `Scales` argument
everywhere: `parseSurface(text, env)`, `lint(draft, env)`, `codebookView(draft, env)`,
`questionJsonSchema(env)`; `elaborate(draft, agency, missing)` takes only what it uses.
`universe` and `instruction` are `Named<TextEntry> = Prose | Ref`: a bare identifier is a
name and must resolve (else a hole whose hint lists the names, "or write it as a
sentence"), anything else is prose. Scheme files are `labels:` (scales, `missing.yaml`)
or `text:` (universes, instructions); an empty `text:` file is a hole, like an empty
question. A reference elaborates to one shared item per scheme entry
(`universe-<name>`, `instruction-<name>`); prose keeps a per-question item. Missing
values are one `ManagedMissingValuesRepresentation` (`missing`) over a code list whose
categories are `IsMissing`; Variables reference it; `CodeDomain` cannot, so the codes
are also stamped as `MissingValue` on every response domain. **Open question for the
owner:** stamp only Variables instead? Two lints: `matches-scale` (inline codes identical
to a bank scale, "use the name") and `missing-code` (an inline code that collides with a
bank missing code). Previews show a resolved reference's name beside its text and the
codebook prints the bank's missing line. Until 8(b) the shell builds the Env from
`model.scales` alone (`envOf`, memoised by `useEnv` so the evaluation cache holds).
Verified against the bank: 332 questions, 0 errors, all DDI-valid with missing values;
no question references a universe or instruction by name yet (they are prose; the bank
is never rewritten programmatically).

**Step 8(a) after-pass (2026-09-24).** `elaborate`'s `missing` is required (a default
would let a caller silently export without missing values). In single-choice, number
and open questions the missing representation is emitted but unreferenced: kept so the
bank's list travels with every export, and decided together with the open owner
question above. Measured: of 24 bank questions with inline `responses`, `matches-scale`
fires on 0 (no de-facto duplicates of shared scales at question level); one full-bank
evaluation (332 questions: parse, lint, elaborate) takes about 30 ms warm, so a scale
edit re-evaluating the whole bank needs no debounce yet. **Carried into 8(b):**
(1) reverse references come from the names *written*, not resolved: `Parsed` gains
`mentions: {scheme, name}[]`, filled whether or not the name resolves, so "used by"
survives a broken or deleted entry ("used by 12, unresolved"); (2) Env identity is a
performance contract: derive it from the scheme entries' `(id, source)` only, never from
all `files`, and test that editing a question leaves it referentially equal;
(3) `missing-code` belongs on the scale file's own evaluation, not per question;
(4) **decided by the owner 2026-09-24: the Env is built from each scheme entry's saved
bank version (`origin.original`), not its local edits.** A question never resolves
against a scale that exists only in this browser, so a DDI export only references what
is on GitHub; an unsaved scheme edit shows its effect on questions once saved. (The
reviewer had recommended local, live evaluation; declined.) A consequence that helps:
the Env changes only on bank load and save, never per keystroke.

**A Variable for every question (decided by the owner 2026-09-24).** This settles the
missing-values question. Select one, number and open questions each emit one
`Variable` named like the question; select-many keeps one per option. A variable's
value representation is the question's domain without `ResponseCardinality` (how many
may be chosen is about asking, not data). It references its question, the universe
(the first real home a universe has had in 4.0) and the concept (on both the variable and
the question), and the bank's `missing` representation; the instruction stays on the
question. Missing values attach only through variables: the `MissingValue` string on
response domains is gone, and the representation is emitted only when a variable
references it. A variable's label is the author's `title` or nothing (DDI does not
invent one). No name or no domain means no variable. Variable IDs are `variable-<name>`,
keyed by the variable's own name, never its question's (26 option variables are
unrelated to their question's name); `NAME_PATTERN` has no hyphen, so hyphenated
prefixes are namespaces that cannot collide with a question ID, and the one dot hangs
parts off a base. **For role 2:** the default "variable named like the question" is a
role-1 convenience meaning "one question asked once"; when a construct asks a question
again, role 2 names another variable pointing at the same QuestionItem
(`QuestionReference` is an array), and `elaborateItems` must rename or suppress the
default. Bank regression: 332 questions give 502 variables, every one DDI-valid. **Two
variable names are claimed by three questions:** `con_nhdkfp` and `con_nhdkdmo` are
declared by `con_nhddk`, `con_nhdnc` and `con_nhdsc` (a v1 slip, also in the migration
report). This is bank content for the owner to fix; a bank-wide "duplicate variable" check
belongs with 8(b)'s bank-level evaluation. **8(b) design point from the after-pass:** duplicate
variables, "used by", "delete a scale 12 questions use" and a future rename are all
queries over one bank-wide table, so build one pure `symbols(parsed)` per question
(variable names it *defines*, from the Draft as `variableSpecs` computes them; scheme
names it *mentions*, resolved or not, from the parser) and one `index(files)`, not a
`usedBy` plus a separate duplicate check. A bank-level finding is attached to each file
involved ("`con_nhdkfp` is also defined by con_nhdnc, con_nhdsc", with links), never
shown in a place of its own. Model identity stays the numeric `Id`; names are only the
index's keys.

**Step 8(b) built (2026-09-24): schemes in the shell.** The Model holds `files:
Record<Id, Entry>`, `Entry = Question | SchemeEntry{kind, name}`; a scheme file's name
is its filename, chosen in a dialog before it exists (`schemeNameProblem` is the one
rule, shown as the author types and enforced by `update`); `missing` is created once
and then opened. Paths follow from kind and name (`schemePath`, `kindAt`, core
`schemes.ts`); a new scheme file saves with no folder dialog. The loader fetches
`questions/`, `scales/`, `universes/`, `instructions/` and `missing.yaml` in one GraphQL
request (verified on the real bank: 332 + 136 + 1 + 2 + 1, about 2.3 s); `mergeBank`
makes each file an entry of the kind its path says and ignores paths it does not read.
Persisted state is version 2 (`files`), and version 1 still reads. The Env is
`envOf(files)`: the saved version of every scheme file, bundled example scales only
when there are none; `evaluations.env` memoises it on the saved schemes' ids and shas.
Core `symbols.ts` is the bank index (`symbolsOf`, `indexOf`, `usedBy`, `bankFindings`),
built from mentions the parser records whether or not they resolve and from
`definedVariables`, which the elaborator now also uses. The tree shows questions by
topic, then a "Shared" tree with one section per kind (always shown, so the kinds are
discoverable; an empty one offers "New…"), each file with "used by N". A scheme file
opens with its own schema, findings (a scale's codes colliding with the missing list
are flagged there, once), a preview, and "used by" links, with a note when it is not in
effect. Deleting a scheme file says how many questions name it. The duplicate-variable
finding shows on each question involved (`con_nhddk` and the two others, verified in the
browser). A hole naming a scheme file that exists only in this browser says it is
not saved yet (`explainUnsaved`), since questions read saved versions only.

**Intended direction, not yet built: keep GitHub's copy apart from working copies
(owner question and step 8(b) after-pass, 2026-09-24).** Today each entry carries the
bank's text as `origin.original`, and the Env keeps its identity only through a cache
keyed on the saved schemes' shas (content addressing; correct and tested). The Elm
answer is a Model slice holding the remote snapshot, **split by kind**:
`remote: { schemes: Record<Path, Blob>; questions: Record<Path, Blob> }`. Then
`envOf(model.remote.schemes)` keeps its identity by structural sharing, memoising on
reference is exact, and "a question Msg never touches `remote.schemes`" is a property of
`update` rather than of a cache key. One undivided `remote` would be a trap: saving a
question would replace it and re-evaluate the whole bank. It also removes the duplicated
`original` ("unsaved" becomes `source !== remote[path].text`) and shrinks `mergeBank`.
Incremental computation with early cutoff (Salsa, Adapton) was considered and rejected:
the graph has two levels and a query engine would be the least readable code here.
**When:** not as a standalone refactor (persistence v3, two-place writes, a `mergeBank`
rewrite, to replace ten correct lines); do it with the first step that must touch origins
anyway, **rename** (a path changes while the remote copy is at the old one) or **propose
a change as a pull request** (a branch that differs from its base is a second remote,
which a per-entry `original` cannot represent). Start there, never add a third copy.

**Step 9 (decided by the owner 2026-09-24): local and remote, each with its own
environment; warn wherever they disagree or work could be lost.** This **reverses** the
morning's decision that questions read the saved bank version, and brings forward the
remote slice above instead of waiting for rename. The Model holds `local` (working
copies) and `remote` (GitHub as last loaded or saved), each split by kind (questions,
scheme files). Questions are shown against the **local environment**, built from the
working scheme files, so a scale edit updates its questions live and a new universe is
usable at once; the **remote environment** is built from GitHub's scheme files. Each
working file keeps its **base** (path, blob sha, text it started from), because telling
"you changed it" from "GitHub changed it" needs three versions, as in git. Derived per
file, never stored: in sync, unsaved, behind (fast-forwarded silently), conflict (warned
*before* a save, not after a refusal), deleted on GitHub, draft. Derived per question:
reads differently on GitHub (it names a scheme file whose local and remote differ; the
missing list touches every question), shown as a finding naming the files. Saving warns
when the question depends on unsaved scheme files and offers to include them; saving a
scheme file says how many saved questions it changes; a DDI download says when it
includes unsaved shared elements. **Every save is one commit of a change set** (one or
more files added, updated or deleted) through GitHub's Git Data API (blobs, tree with
`base_tree`, commit, fast-forward ref update), chosen by the owner over one commit per
file so the bank is never half-updated. It replaces the contents API as the only write
path. Staleness is checked per file against the branch head's blob shas before the
commit, and the ref update refuses anything but a fast-forward. Plan: (9a) data layout
and the two environments; (9b) sync states, badges, banners, the pre-save conflict
check; (9c) disagreement findings and change-set saves through the Git Data API.

**Save is not publish (owner, 2026-09-24).** Every user works on their own branch, and
the bank changes only when that branch is merged into `main` through a pull request.
Save is a commit to the user's branch (frequent, safe, never changes the bank, and
work lives on GitHub rather than only in one browser); propose opens or updates the pull
request; publish is the merge, governed by GitHub (branch protection and review on
`main`), never by the app. A commit to `main` is never a proxy for a save. This replaces
"save commits directly to the branch in the Bank panel" (step 5) and folds the backlog's
"propose a change as a pull request" into step 9. Open for the step 9 design: branch
granularity (one per user or one per proposal), which remote each comparison uses
(`main` or the user's branch), and read-only contributors (forks, or write access with
`main` protected).

**Step 9 design (before-pass and addendum, 2026-09-24), adopted.** One branch per user,
`qretools/<login>`, with one pull request to `main`; after a merge the app deletes the
branch (blob shas are content addresses, so every base stays valid and `remote`
becomes `bank` again); a pull request closed unmerged leaves the branch alone (resetting
would silently fast-forward the author's saved work away). A branch per proposal is
backlog; the cost accepted: anything saved while a proposal is in review joins it.
Contributors get write access through a team, with `main` protected by a ruleset
(require a pull request, block force-push and deletion); forks were rejected (a
fine-grained token has one resource owner, unverified; private forks need org settings).
Merging is GitHub's job, never the app's. Model: `local` (working copies by `Id`, split
by kind), `remote` (the user's branch, by path, split by kind), `bank` (`main`, the same
object as `remote` while the user has no branch), `activity` beside the content.
Against `remote`: bases, sync states, rebase, conflicts, commits. Against `bank`: "not in
the bank yet", "changes N questions in the bank", the DDI note, a "proposed" badge.
Sub-steps: (9a) layout; (9b) sync states and resolution (`takeGitHubs`, `keepMine`);
(9c) change-set commits to the user's branch through the Git Data API (create the branch
on first save; one retry on a lost fast-forward) and the bank-disagreement findings;
(9d) branch lifecycle: load branch and pull request state, "proposed" and "behind the
bank", open the proposal, update from the bank (merges API; a 409 is a real conflict,
resolved on GitHub), reset after a merge. **For the owner to check before 9d:** protecting
`main` on a private repository needs a paid GitHub plan (Team or above); whether
"update from the bank" runs automatically on load (proposed) or by a button.

**Step 9a built (2026-09-24).** `Model.local {questions, schemes}` by `Id`; `remote` and
`bank` `{questions, schemes}` by path (`Blob {sha, text}`); each working file has an
optional `base {path, sha, text}` in place of `origin` (none means a draft);
`activity: Record<Id, Activity>` (absent means idle). `sync.ts` replaces `merge.ts`:
`syncOf` (draft, inSync, unsaved, behind, conflict, deletedOnGitHub, from the three
versions), `claimOf`, `remoteOf` (keeps a slice's reference when its shas match) and
`rebase` (fast-forwards what only GitHub changed, drops clean deletions, keeps changed
files with their base, adds unclaimed paths; keeps references when nothing changes).
`update` writes `local` only through `withFile`/`add`/`without`, so a question edit
replaces only `local.questions` (tested with `toBe` on every other slice). The Env is
`envOf(local.schemes)`, memoised on that reference; the sha-keyed cache and
`explainUnsaved` are gone. Persisted state is version 3 (working copies only; `remote`
is rebuilt from the bases, which record the last GitHub state this browser knew); v2 and
v1 upgrade step by step, verified in the running app. Until 9d a save still writes to
the branch in the settings through the contents API, and `bank` moves with `remote`.
Measured: typing in `agree4` (re-evaluating the bank per keystroke) takes about 30 ms a
keystroke with no long task, so no debounce.

**Step 9a after-pass (2026-09-24).** `remote` is not persisted: before this session's
load it means only "last known, as of each base", which hides conflicts and deletions
on GitHub. So writing waits for the load: `writeBlocked(model)` is the one rule (not
connected, read only, or "Checking GitHub…" until `loading` is `loaded`), `update`
refuses on it and the header shows it; 9b shows no conflict or deleted-on-GitHub badge
before the load. (The reviewer withdrew storing `remote` as a diff from `bank`: the
branch and pull request are loaded fresh in 9d too.) `taken` also counts paths other
working files claim (a changed file deleted on GitHub keeps its base). `rebase` computes
the claimed paths first, as a value. The example scales stand in while no bank is
known (`remote.schemes` empty), beneath local ones, so one local draft does not blank
questions on an example scale. `envOf` runs uncached inside `update` on the save and
delete paths, by design (a comment says so). Carried into 9b: when a fast-forward
replaces the open file's text, the editor document must be replaced. Notes for step 5 from the step 4 review: identify questions by a
numeric `Id` with `nextId` in the Model (never by `name`, which may be a hole or a
duplicate); `screen: list | editing{id}`; `init(flags)` with stored data parsed by a Zod
schema, anything unparseable becoming a finding; `update` emits a `persist` Cmd and
debouncing happens in `exec`, never in `update`; `editor.sync` must take the question
id and reset editor state when it changes, or undo history leaks from one question into
another; normalise `\r\n` to `\n` at the upload boundary, or diagnostics drift;
`parseAgency` at the shell boundary for a readable message. A malformed *bank* scale is the user's
file: its findings must be shown, unlike a malformed bundled example, which
`model.ts` simply drops.

**Added 2026-09-23, ahead of step 5.** The question bank is migrating from the v1 repo
into `JHUCities/bas-question-bank` (plan and decisions: that repo's
`migration/README.md`; the v2 checkout is at `../bas-question-bank`). Steps, in order:
(6) surface extensions the bank needs: `title`, `note`, a verbatim `legacy` block that
lints, named shared scales (`responses: agree4`, scales as a parse input, names
completed and hovered in the editor, resolved in previews), and select-many as one
variable per option; (7) the importer, a pure v1-record-to-surface function plus a
script living in the bank repo's `migration/`, with a per-question report; then (5)
storage and CRUD against GitHub. Migration edits nothing programmatically: `intent`
stays a hole on every migrated question, and unmapped fields go under `legacy`.
