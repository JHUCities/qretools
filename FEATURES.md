# Features, issues and tasks outside the planned steps

Everything here was raised while building steps 0 to 4 (by the project owner, by the
implementing agent, or by a step reviewer) and is **not** part of the planned steps in
`AGENTS.md`. Step 5 (CRUD, storage, upload, download) and the role 2 lookahead live
there, not here.

Settled decisions belong in `AGENTS.md`. This file is a backlog: nothing in it is
committed to. When an item is taken up it becomes a discrete step and goes through the
before-and-after review gate, unless marked *tweak*.

Size: **S** under an hour, **M** a step, **L** more than one step.

## Needs a decision from the project owner

- **A title field in the surface language.** BAS codebook titles are short curated
  labels ("WATER QUALITY CONCERN", "FLOOD: BASEMENT"). The surface has no `label` or
  `title`, so the codebook preview uses the concept, then the name. Add a field, or keep
  deriving it? **S** once decided.
  *Evidence, 2026-09-21:* every question in the real BAS bank
  (`JHUCities/baltimore-area-survey`) has a `title`. Add the field.
- **Select-all as one variable per option.** BAS publishes a select-all item as one
  binary variable per option ("STEM: OPTION"). We emit a single QuestionItem with a
  cardinality. Decide the DDI shape (and the codebook preview) for select-all. **M**.
  *Evidence:* the real bank models select-all with `creates_variables`, one named
  variable per option, each with an `option_title` and a yes/no label set.
- **`parseAgency` at the shell boundary** so a bad agency value gets a readable message,
  not a 180-character regex. The agency itself is decided: `edu.jhu.21cc`. **S**.
- **Soft holes are accepted (2026-09-23); which fields are "recommended" is open.** See
  *Soft holes* below; the tier only works if it is small. Candidates: `title`, `concept`.

- **Merge identical scales (deferred 2026-09-23).** The v1 bank has 226 scales of which
  about 48 duplicate another by content; the importer keeps every referenced scale as
  its own file, so questions keep the scale name they had. Merging means choosing a
  survivor and rewriting references, which edits question files; a lint that points
  out identical scales is the gentler first step. **M**.
- **Versioning, seen in the migration.** Two 2026 candidates revise bank questions; the
  importer keeps the old record under `legacy.superseded`, and 15 questions carry a
  v1 `versions` block under `legacy`. These are exactly what DDI-Lifecycle versions
  model (one item, version 1 and 2, each instrument naming the version it used). The
  design belongs with survey composition. **L**.
- **A home for shared scales in the UI** (asked 2026-09-24). Scales exist only as files
  the app reads: the tree does not show them, nothing lists them, and none can be created
  or edited in the tool. Today a scale is discoverable only at the point of use:
  completion after `responses: ` lists every scale with its labels, a mistyped name is a
  hole whose hint lists the names, and the codebook preview shows the resolved labels.
  Hovering the name shows the generic `responses` description, not the scale's labels
  (verified), which is the gap Hazel's live projection would fill. Proposal: a
  `scales/` folder in the tree (it is one in the repo); opening a scale shows its labels
  and the questions that use it (reverse references, derived from the Model), with the
  same save flow and a "New scale" template; from a question, go to the scale; hover on
  the name shows its labels; a lint that says an inline list matches an existing scale
  (extract-to-shared). **M**.
- **Fields the real bank uses that the surface lacks:** `if_condition`, `validation`
  (both role 2 expressions), `string_label`, `note`, `vargroup`, `surveys_used`,
  `versions`, `restricted_access`, markdown emphasis and `{{fills}}` in question text.
  An importer from the v1 files would measure the gap across all 294 questions. **M**.

## Bank and storage (cut from step 5, port shape unchanged)

- **Templates could live in the bank repo** so the survey team curates them, rather than
  being bundled with the tool. **S**.
- **The open question in the URL** (asked for 2026-09-24), so links to a question can be
  shared: `#questions/<topic>/<name>.yaml` for bank files, which have a stable identity;
  drafts do not until named. In the architecture the URL is an effect: `update` decides
  the open question, a `setUrl` Cmd writes the hash, and a page load or back-navigation
  arrives as a Msg. **S**, next.
- **"Propose a change" by pull request** for read-only users and for review: a second
  adapter behind the same `Store`/Msgs. **M**.
- **GitHub App sign-in** with the small token-exchange Worker (decided, deferred by the
  owner). Replaces token paste behind `connectRequested`. **M**.
- **Move a question to another topic** (asked 2026-09-24, as drag-and-drop). No move
  exists yet: a path is fixed at save. A move is a delete plus a create, one commit if
  done through the Git Data API (a tree write), two through the contents API. Suggested
  shape: a "Move to…" action on the open question reusing the save dialog's folder
  picker; drag-and-drop in the tree as a later gesture over the same Msg. Primer's
  TreeView has no drag-and-drop of its own. Same mechanism as rename. **M**.
- **Rename a bank question.** Today a bank file saves to the path it was opened at even
  if `name` changed; needs delete-and-create in one step. **S**.
- **Auto-refresh and presence.** No polling; a stale save is the only signal that
  someone else changed a file. **M**.
- **Seeded example drafts** duplicate bank questions by name once connected; a
  "New from example" only, or dropping unmodified seeds on first connect, would be
  cleaner. **S**.
- **Keyboard navigation and better search** in the list. **S**.
- **`parseAgency`** at the shell boundary when the agency becomes a setting. **S**.
- **A `Store` fake for a mount smoke test** in jsdom; today update and the adapter are
  unit-tested and the flow is verified in a real browser by a scratch script. **M**.

## Editor experience

- **Dark mode for CodeMirror.** Primer switches with `colorMode="auto"` and the hole
  styling follows its tokens, but the editor's syntax theme is still the light default.
  Pick a dark base theme from `useTheme().resolvedColorScheme`. **S**.
- **Previews as tabs** (Primer `UnderlinePanels`, experimental) instead of stacked panes,
  if the right column gets crowded. **S**.
- **A `Store` fake for a mount smoke test** now maps to rendering `App` with a fixture
  store in jsdom; the Browser and tree are tested, `App` is not. **S**.
- **Precise spans: key, value, whole.** The ranges index holds one span per path, from
  key start to value end. The parser gives the key and value their own ranges. With
  both, an unknown field underlines the key, a wrong type underlines the value, and a
  jump lands on the part at fault (`1st`, not `name: 1st`) ready to type over. Touches
  `parse.ts`, `locate`, `diagnostics.ts`. **M**.
- **Line numbers on findings.** The findings pane gives no sign its cards are clickable.
  A "line 4" label is both information and the jump affordance. The `yaml` package
  ships a line counter. **S**, best done with the item above.
- **Where a missing field's jump lands.** A hole for a key not yet typed resolves to the
  end of the document. Better: the line where the schema order says it belongs. **S**.
- **Spans inside a value.** Underline only the "and" in a double-barreled question. The
  lint sees the parsed string, not the source; the two differ for quoted, escaped or
  folded values. Exact for plain single-line values only, so it needs a fallback to the
  whole value. **M**, low priority.
- **A select-many option whose variable is unknown prints `?`** in the codebook line
  while `name` is a hole. Everywhere else a missing thing is a clickable hole slot;
  here it is a literal question mark. Make the values a list of slots, or print
  `<name>_wh` with the name as the hole prompt. **S**, cosmetic.
- **Quick fixes on findings.** CodeMirror diagnostics can carry actions. Candidates:
  quote a text containing `: `, quote a numeric label, swap `min` and `max`, add a
  "None of these" response, add a missing recommended field. The fix is an edit
  described as data by the core and applied by the shell. **M**.
- **Completion does not know the one-domain rule.** With `number:` present the menu
  still offers `responses` and `open`; picking one gives an immediate, clear error. The
  rule lives in `parse.ts`, not in the JSON Schema the editor sees. Either express it in
  the schema (`oneOf`, which the completion package handles poorly) or filter in
  `complete.ts` using a core predicate. **S**.
- **Open completion unprompted on a blank line** while the document still has holes.
  Removes the need to know a shortcut at all. Risk: noisy. **S**, try it and see.
- **A keyboard and features cheat sheet in the page.** The owner asked twice what the
  editor can do. A small "?" popover: Cmd-I / Option-Esc, F8, click a finding, click a
  hole, hover for docs, fold, move and duplicate lines. **S**, *tweak*.
- **A visible way to open the findings panel.** Cmd-Shift-M is probably taken by
  Chrome's profile menu on a Mac (unverified: headless Chrome cannot tell). F8 and
  clicking cover the same ground. **S**.
- **Livelits.** An inline widget at a hole, first candidate a scale picker inside an
  empty `responses:` that writes the YAML. CodeMirror block widgets are the mechanism.
  This is the PLDI 2021 idea and a headline feature of the thesis. **L**.
- **Dark theme.** Tokens are already CSS variables. **S**, *tweak*.

## Surface language and findings

- **Show an opened-but-empty optional field as a hole in the previews.** The parser now
  reports an empty `title:` as a hole (2026-09-24), but the Draft still omits the field,
  so the codebook preview falls back to the concept rather than showing a clickable
  hole slot. Carrying `Absent | Hole | Filled` on the Draft would let the previews show
  it. **S**.
- **Implicit arguments: defaults the author can see.** Elaboration may fill what the
  author omits, as an Agda elaborator fills implicit arguments: `select` already
  defaults to `one`; `universe` could default to "All respondents"; `instruction` could
  derive from the domain ("Select all that apply"). The essential half is showing the
  assumed value, muted, in the previews. **M**.
- **`universe` is a type annotation.** Optional because it is inferable: in role 2 the
  universe is synthesised from the skip logic and a declared one is checked against it.
  Recorded here so the role 1 model of `universe` does not preclude it.
- **Soft holes: a recommended tier.** A missing recommended field (candidate:
  `concept`) is an `info` finding with a one-click "add it" quick fix. Keep the tier
  tiny; advice that fires on every new question gets ignored. **S** after quick fixes.
- **Known verbatim oddities in the imported bank.** Some titles end in a colon
  (`Type of Heating:`), and 93 multi-line texts end in a newline, which reaches DDI
  QuestionText. Both are as v1 had them. Lints for a trailing colon in a title and a
  trailing newline in text would make the first authoring pass find them. **S**.
- **Parse messages that leak YAML jargon.** A duplicate code reports "Map keys must be
  unique". Say "Response code `1` is used twice". **S**.
- **`01` and `1` collide.** YAML types both as the number 1, so they are reported as
  duplicate keys even though the author's spelling is preserved. Decide whether
  distinct spellings are distinct codes (then parse with a string-keyed schema for
  `responses`). **S** to **M**.
- **Double-barreled lint precision.** Tuned on the 161 BAS 2025 question texts: a bare
  "and" test fired on 8%, nearly all false; two fixes cut it to about 1%. Add those 13
  texts as fixtures, so the tuning is reproducible. **S**.
- **`source: Original` is not really a basis.** It is emitted verbatim into
  `BasedOnObject`. Decide whether "Original" should elaborate to nothing. **S**.

## DDI output

- **Schema validation checks nothing inside `ResponseDomain`.** The official JSON
  Schema makes it a 28-way `anyOf` of permissive objects; `{ Label: "oops" }` passes.
  Unit tests carry that weight today. Option: our own structural check of the subset we
  emit, reported as `ddi-invalid`. **M**.
- **The meaning of a reference's `value` is inferred, not confirmed.** We emit
  `[Agency, ID, Version]`, from reading old COGS sources; current COGS differs and the
  schema constrains nothing. Isolated in `ref()`. Confirm with the DDI Alliance or the
  COGS maintainers, ideally against a published 4.0 JSON example. **S** to ask.
- **`$type` on `ResponseDomain` is our addition.** The JSON property loses the XML
  element name that says which domain it is. We add `$type: "CodeDomain"` and so on; it
  validates. Worth raising upstream as a gap in the JSON serialisation. **S** to report.
- **`universe` is emitted but unlinked.** QuestionItem has no universe reference in 4.0.
  Resolved in role 2 through constructs.
- **Track DDI-Lifecycle 4.0 to adoption.** Vendored at beta 4 / RC1. Re-vendor when it
  is adopted; the "compiles the official schema" test guards the ajv options.
- **A DDI-Lifecycle 3.3 XML emitter** if a consumer (Colectica, an archive) needs it.
  The elaborator is isolated for this. **L**, only on demand.

## Engineering and housekeeping

- **Commits are GPG-signed with a curses pinentry** that needs the owner's own terminal;
  an agent session cannot sign until gpg-agent is unlocked there.
- **No end-to-end test in the repository.** Browser verification was done with
  throwaway Playwright scripts outside the project. Add one smoke test: load, blank,
  complete a field, click a finding, check the DDI badge. Remember that synthetic keys
  skip the macOS dead-key layer. **M**.
- **No DOM tests for `panes.ts`.** They are stateless functions from core data to
  elements, so they are cheap to test once a DOM environment is configured. **S**.
- **Only Chrome has been exercised.** Safari handles dead keys and composition
  differently. **S** to check by hand.
- **Bundle size is about 1.1MB**, mostly `codemirror-json-schema`'s dependencies
  (shiki, markdown-it, json-schema-library), plus a lazy 1MB chunk for the DDI schema.
  Fine for a prototype. The surface schema is flat, so hand-written completion and
  hover of about 80 lines is a realistic replacement; `complete.ts` is already a third
  of it. The package is in the settled stack, so this is a decision, not a cleanup. **M**.
- **ajv compiles with `new Function`**, which needs `unsafe-eval`. If the page is ever
  served under a strict Content Security Policy, precompile the validator with ajv
  standalone. **M**, only on demand.
- **Deploy as a static page on GitHub Pages** (accepted 2026-09-23, not scheduled) so
  students can use it without a checkout. Its URL also becomes the redirect URL for the
  eventual GitHub App login, so decide the URL once. **S**.
- **Accessibility pass.** Announce only the findings count, never the panes that redraw
  on every keystroke; check focus order and contrast. **S**.
- **The respondent preview is not a working form.** Its inputs hold browser state, kept
  across unrelated edits by skipping unchanged panes. Do not let it drift into a survey
  runtime; role 2's respondent simulator is the place for that.

## Considered and cut, with the reason

- *Lint: single-select needs a residual option.* Fires on `nhd_sat`; bipolar scales are
  exhaustive without one.
- *Lint: question text must end in "?".* BAS uses stems such as "Please indicate...".
- *Lint: number without a unit.* "How many children" makes it arguable.
- *Lint: duplicate codes.* The YAML parse already reports them; a lint would double up.
- *"or" in the double-barreled lint.* It mostly offers alternatives ("rent or own") or
  balanced wording ("satisfied or dissatisfied"), which is good practice.
- *Forcing Option-I to open completion on a Mac.* It is how authors type accents
  ("rôle"). Cmd-I and Option-Esc do the job.
- *`Object.freeze` on drafts.* Readonly types are the guarantee, as in Elm.
- *A findings slot on `elaborate`.* It would always be empty.
- *Did-you-mean for unknown fields.* The hint lists the eleven fields; enough for now.

- **Fix the duplicate `con_` variables in the bank (owner's edit).** `con_nhdkfp` and
  `con_nhdkdmo` are each declared by `con_nhddk`, `con_nhdnc` and `con_nhdsc`; rename them
  per question (for example `con_nhddkfp`, `con_nhdncfp`, `con_nhdscfp`). The app now
  flags them on each of the three questions.
- **Bank-wide duplicate variable check.** Two questions must not declare the same
  variable name; today `con_nhdkfp` and `con_nhdkdmo` are each claimed by `con_nhddk`,
  `con_nhdnc` and `con_nhdsc`. Needs 8(b)'s bank-level view; fixing the three files is
  the owner's edit.

## Generality (the core tenet: any DDI-conformant bank)

Places where the code still assumes BAS or JHU, found 2026-09-24:

- **Agency is a constant** (`AGENCY = "edu.jhu.21cc"` in `src/app/model.ts`). It should
  come from the bank (e.g. a bank-level settings file beside `missing.yaml`) or a setting.
- **Default bank settings name `JHUCities/bas-question-bank`.** Fine as a visible
  example; a first run for another team should start empty or ask.
- **Select-all coding is fixed**: one variable per option on a built-in `yesno01`
  scale (0 No, 1 Yes), a BAS publishing choice and a core constant that the bank must
  mirror by name. Should be a bank convention, a named scale in the bank.
- **Option variable naming** (`<name>_<code>` default, the `option-variable-prefix`
  lint) reflects BAS habits; another bank may name differently.
- **The bank layout** (`questions/<topic>/`, `scales/`, `universes/`, `instructions/`,
  `missing.yaml`) is this tool's own format. Open question for the owner: does "any
  DDI-conformant bank" also mean reading banks that exist only as DDI (3.3 XML or 4.0
  JSON), i.e. an importer from DDI into the surface language?

- **Fill holes with a language model, given what is in scope (after the Cloudflare
  Worker).** Prior art: *Statically Contextualizing Large Language Models with Typed
  Holes* (Blinn et al., OOPSLA 2024, https://arxiv.org/abs/2409.00921), which gives the
  model the hole's expected type and typing context from Hazel's language server rather
  than nearby text. Here: draft a hole (first `intent`, of which the migrated bank has
  330) from the question's text, concept, universe and resolved scale labels, plus the
  field's description from the surface schema. The draft is a suggestion the author
  accepts or edits, never written silently; the bank is never edited programmatically.
  Needs a model call, so it goes through the Worker. Raised 2026-09-24.
- **8(c) as a cursor inspector (built 2026-09-24; see AGENTS.md).** Hazel's idiom: a pane that
  follows the cursor and reports the element under it (a name's binding and "used by",
  what belongs in a hole and the names in scope, an unresolved name with "New universe
  `renters`"). Pure core function from cursor path to view; "go to definition" and
  "create it" are a link and a button in it. Livelits/projectors and structure editing
  are beyond a text editor's horizon and are not planned.

- **Mark questions that read differently from the author's branch, in the tree
  (candidate).** A question naming a scheme file with unsaved edits shows "with …" beside
  Save, but nothing marks it in the bank browser. Suggested by the 9c after-pass; not
  built.

- **Old links after a move (candidate).** A link to a question's old path now finds
  nothing and says "not on that branch". A fallback could open the local question with
  the same filename in another folder, when there is exactly one. Cheap; not built.

- **Front-end audit (2026-09-25): done.** Every item from the audit is built: the app
  shell; dark mode on Primer's root theme and CodeMirror tokens; the editor's name;
  PageHeader with inactive, explained buttons and loading states; links that navigate
  and link buttons that act; native dialog forms with Primer validation; CSS on Primer's
  tokens with scoped selectors; a keyboard-scrollable previews region; the session line
  as a live status; findings as an ActionList; Stack for flex rows; tree counters,
  spoken marks, spinner, skeleton and blankslate; the codebook's particulars as a
  `<dl>`; per-preview radio groups; one table of scheme names; narrow screens as
  separate views. Two TreeViews stay, each named by its heading (TreeView has no group
  headings).

- **Scope kept work to its bank and login.** Signed out, drafts and unsaved edits are
  kept for the next sign-in, but not tagged with the repository or login they came
  from: signing in to another bank shows them there, where a save would file them.
  Tag stored working copies with owner/repo/login and show only matching ones (never
  delete the others: a draft you cannot save is a draft you lose).

- **TODO: a starter bank repository, with setup instructions.** The Bank dialog used to
  explain the own branch and the app installation in prose (removed 2026-09-25: it
  was clutter). Replace it with a template repository a team creates its bank from,
  already configured: the folder layout (`questions/`, `scales/`, `universes/`,
  `instructions/`, `missing.yaml`, `scales/yesno01.yaml`), a ruleset protecting `main`
  (pull request required, no force-push or deletion), "Automatically delete head
  branches" on, and the qretools GitHub App installed, plus a short README of those
  steps. The dialog then links to it once.
