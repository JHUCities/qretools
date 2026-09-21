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

No UI framework for now; the preview is a pure function from document to DOM.
If reactivity gets painful, Solid is the fit.

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
  (GitHub, or Codeberg/Forgejo) via its REST API with hash preconditions
  (compare-and-swap). Login is OAuth to the forge. Upload is a pull request; merge is
  promotion to the bank and gives provenance for free. Git prevents silent overwrites,
  not simultaneous edits; a bad merge is just a document with holes. Git LFS only for
  media. Real-time co-editing later via Yjs; Grove is the principled endgame.

- **Notes for role 2 from the step reviews.** `elaborate` returns a whole document;
  an instrument is many questions plus constructs, so split out
  `elaborateItems(draft, agency): Item[]` and call `documentOf` once at the edge
  (concatenating item lists is trivial; merging documents is not). `documentOf`
  silently overwrites on an ID collision, unreachable today, reachable then.
- **Surface-language gaps seen against the BAS codebook (raise with the owner).** BAS
  titles are short curated labels ("WATER QUALITY CONCERN"), and the surface has no
  `label`/title field; the concept stands in. BAS publishes select-all items as one
  binary variable per option ("STEM: OPTION"); we emit one QuestionItem.
- **Assumption: the DDI agency is the placeholder `org.example.qretools`** until the
  project picks its registered agency identifier. It is an explicit input to
  `elaborate`, set in `src/app/model.ts`.

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

Steps 0 to 4 are done. Notes for step 5 from the step 4 review: identify questions by a
numeric `Id` with `nextId` in the Model (never by `name`, which may be a hole or a
duplicate); `screen: list | editing{id}`; `init(flags)` with stored data parsed by a Zod
schema, anything unparseable becoming a finding; `update` emits a `persist` Cmd and
debouncing happens in `exec`, never in `update`; `editor.sync` must take the question
id and reset editor state when it changes, or undo history leaks from one question into
another; normalise `\r\n` to `\n` at the upload boundary, or diagnostics drift;
`parseAgency` at the shell boundary for a readable message.
