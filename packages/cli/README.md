# The `qretools` command

For a workspace on disk, in CI or at a terminal. Install it from npm (Node 22 or later),
or run it without installing. `check` and `export` of a folder need only Node. Reading a
workspace in another repository (`owner/repo@v1`) and `build` also need
[git](https://git-scm.com) on your PATH.

```sh
npm install -g qretools       # then `qretools …`
npx qretools check .          # or one run; pin a version in CI: npx qretools@2.0.0-alpha.1
```


```sh
qretools check path/to/workspace            # findings, one per line; exit 1 on anything to fill in or fix
qretools check path/to/workspace --strict   # warnings fail too
qretools export path/to/workspace -o questions.json   # its questions' DDI, validated
qretools build path/to/workspace             # its last commit's DDI, versioned from git history, in path/to/workspace/dist/ddi.json
qretools codebook path/to/workspace -o codebook.html  # its questions' codebook, one HTML page
qretools codebook ddi.json -o codebook.html  # the codebook of any DDI-Lifecycle 4.0 JSON
qretools paths wave1.json -o paths.html      # the paths through an instrument's DDI, one HTML page
qretools qsf-map dist/instruments/wave1.json -o maps  # the QSF column map of an instrument's survey
qretools responses export.csv --map maps/wave1-ddi-qsf.columns.json --ddi dist/instruments/wave1.json  # a Qualtrics export, by DDI variable
qretools responses data.csv --map wave1-ddi-release.columns.json --ddi wave1.json  # a data file, by DDI variable
qretools filter answers.csv --ddi wave1.json --access public  # the answers a level can see
```

A workspace is one folder: `workspace.yaml` (its settings), `questions/<folder>/`, the
shared folders (`scales/` and so on), `missing.yaml`, `select_all.yaml` and
`instruments/`. `check` reports findings for its questions, its shared files and every
instrument. An instrument reads its own workspace as `../`, under the agency in
`workspace.yaml`. `check` also notes YAML files it ignores. The fields of `workspace.yaml`,
the access levels among them, are in the [core README](../core/README.md).

## Workspaces in other repositories

A workspace in another repository (`owner/repo@v1`, or `owner/repo/folder@v1`) is read at
that tag with your own `git`, so any credentials git has reach a private repository. Only
`refs/tags/v1` is fetched, never a branch of that name. The fetch is shallow and takes only
the folder. It goes into a cache by tag and folder (`$XDG_CACHE_HOME/qretools`, else
`~/.cache/qretools`), with the commit the tag pointed to. Later runs read the cache.

A tag can move; a commit can't. So `instrument export` records the commit each tag points
to, under `locked:` in the workspace's `workspace.yaml`, as a build tool writes its
lockfile (Cargo, npm). Commit that file with the rest. Saving an instrument in the app does
the same.

- A tag that now points to another commit is a `moved-tag` warning on its `uses` line in
  `check` (so `--strict` fails on it). The next export or save records the new commit and
  says `[WARNING]`. Reviewers see the changed line in `workspace.yaml`.
- A tag with no record (an instrument written by hand, never saved in the app or
  exported) is an `unlocked-tag` warning in `check`.
- Records are only added or updated, never removed. This relies only on git, so it works
  on any forge.
- A tag is read from the cache, so a moved tag shows where the cache is fresh, as in CI.
  To read a tag again here, delete its entry in the cache.
- An instrument outside a workspace, or in one without a `workspace.yaml`, still exports,
  but its tags aren't recorded.

Its questions' DDI says where each was read: the UserAttributePairs `git-repository`,
`git-path`, `git-tag` and `git-commit` (the commit the tag pointed to), beside the file's
`git-blob` UserID. Versions come from the tag's message when it is a release's
(`build --tag-message`, below) and matches the files at the tag. Otherwise every version is
1, and a message that doesn't match is a warning on the `uses` line. A workspace read from
a folder with `--bank` records nothing about where it came from.

In CI, a private repository needs git credentials, such as `GITHUB_TOKEN` given to git
(`git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf https://github.com/`)
or a deploy key.

## Instruments

`qretools instrument check <file>` and `qretools instrument export <file>` work on one
instrument. They use its workspace's agency (`workspace.yaml`), or `--agency <agency>`
for a file outside a workspace's `instruments/`. The instrument reads its own workspace
(`../`, the folder above it) and others at their tags. `--bank alias=dir` reads an alias
written as `owner/repo@v1` from a folder instead, to work offline. Any other local address
is refused.

`qretools instrument export <file> --qsf` writes the instrument as a Qualtrics survey
(QSF), made from its DDI. Import it under Projects → Create project → Survey. Anything
Qualtrics can't do as the DDI says is reported at its line, and an error writes nothing.

## Build

`build` is `export` with real versions. Each question's version counts the changes to its
file, and to every shared file it names, along the first-parent history of HEAD. So a
question gets a new version when its scale changes. Its date is that commit's, and its git
blob is a UserID.

- It builds the last commit, not your working files. Uncommitted changes are left out,
  and it says so.
- It needs the whole history. A shallow clone is refused; in CI, use `fetch-depth: 0`.
- It writes `<outdir>/ddi.json`. `-o` names the folder (default `<dir>/dist`).
- It writes the DDI of each instrument to `<outdir>/instruments/<name>.json`. In the same
  folder, it writes the Qualtrics survey of the instrument, `<name>.qsf`. If Qualtrics
  cannot run an instrument, `build` gives a warning. It then writes no survey for that
  instrument.
- It does not write a column map. Use `qsf-map` (see "Make the QSF column map").

`--tag-message <file>` also writes the text for a release's tag: a line, a blank line,
then each file's version, date and blob as JSON. Tag the built commit with it, verbatim,
so git keeps it whole: `git tag -a --cleanup=verbatim -F <file> v2 HEAD`. A workspace can
do this in a workflow it runs by hand with the tag's name (qretools-gss's `release.yml`
is one). The tag points at the default branch's own commit, and only the tag is pushed.

## Make the QSF column map

The QSF column map gives the DDI variable of each column in the response export of a
survey that `build` wrote. Make the map from the DDI of the instrument that you fielded:

```sh
qretools qsf-map dist/instruments/wave1.json -o maps
```

1. Get `<name>.json` from the release that made the survey that you fielded.
2. Run `qretools qsf-map <name>.json -o <dir>`. The command writes
   `<dir>/<name>-ddi-qsf.columns.json`.
3. Read each `qsf-unmapped` warning. The map has no column for the item that the
   warning names.
4. Commit the map. Do not make it again for a survey that you fielded.

The map has `"source": "qsf"` and the SHA-256 digest of the DDI file. `responses` reads
the export only with that DDI. If Qualtrics cannot run the instrument, the command writes
no map, and it shows each error. `-o` is necessary.

The map records the version of qretools that ran `qsf-map`. If this is not the version that
built the survey, `responses` gives a note. To prevent the note, use the same version for
the two commands.

## Export from Qualtrics

The QSF column map gives the DDI variable of each column in a Qualtrics response
export. To get an export that the QSF column map can read, do these steps. The labels
are those of Qualtrics in November 2026.

1. In Qualtrics, import `<name>.qsf` under Projects → Create project → Survey.
2. Collect the responses.
3. Open Data & Analysis.
4. Open Export & Import, then select Export Data.
5. Select the CSV tab.
6. Select "Export values".
7. **Caution: do step 8. If you do not, all the options of a select-all question go into
   one column. The QSF column map cannot read that column.**
8. Select "Split multi-value fields into columns".
9. Download the file.

Row 3 of the file gives the ImportId of the column of each choice question as JSON. An
example is `{"ImportId":"QID3","choiceId":"10"}`. In the QSF column map, `importId`
matches `ImportId`, and `choice` matches `choiceId`.

Qualtrics does not always write the code of an option as the code is in the DDI. It
uses one rule for the name of the column of a select-all option, and for the value of a
single-choice question:

- If the code starts with a number, Qualtrics writes that number in its shortest form.
  Spaces, a sign or a decimal point can come before the number. For example, `010`
  becomes `10`, `+1` becomes `1`, `1.50` becomes `1.5`, `1e2` becomes `100`, and
  `1,5` becomes `1`.
- If the code does not start with a number (for example `DK` or `opt1`), Qualtrics
  writes the position of the option, from 1.

The QSF column map gives the code for each name or value that Qualtrics writes
differently. If two options of one question get the same name or value (for example `1`
and `01`), the QSF column map does not read the two options, and `build` and `qsf-map` give a
`qsf-unmapped` warning.

**Caution: do not use the code `Infinity`, or a number that is too large for Qualtrics
(for example `1e999`). Qualtrics writes nothing for this option, and the answer is
lost.** `build` and `qsf-map` give a `qsf-unmapped` warning for this code.

A QSF column map from qretools 2.0.0-alpha.9 or earlier does not give these values. To
get them, run `qsf-map` again. The QSF and its QIDs do not change, so a survey that
collects responses can use the new map.

## Read the responses

`responses` reads a Qualtrics response export with its QSF column map. It writes one line
for each value, with the DDI variable that records the value:

```sh
qretools responses export.csv --map maps/wave1-ddi-qsf.columns.json --ddi dist/instruments/wave1.json -o wave1-responses.csv
```

```csv
respondent,variable,row,value
R_1,urn:ddi:org.example:instrument-wave1.var-tenure:3,,2
R_1,urn:ddi:org.example:instrument-wave1.var-modes_b:3,,1
R_1,urn:ddi:org.example:instrument-wave1.var-age:3,1,40
R_1,urn:ddi:org.example:instrument-wave1.var-age:3,2,D
```

To read an export, do these steps:

1. Do the steps in "Export from Qualtrics" to get the export.
2. Find the QSF column map of the survey (see "Make the QSF column map").
3. Find the DDI that the map was made from.
4. Run `qretools responses <export.csv> --map <name>-ddi-qsf.columns.json --ddi <name>.json`.
   If `<name>.json` is in the same folder as the map, you can omit `--ddi`.
5. **Caution: do not write the output into `dist/` or into a folder that CI publishes.
   The output holds the responses.** Use `-o` to write the output to a file. Without `-o`,
   the command writes it to stdout.

The output is long CSV (one value on one line), in four columns:

- `respondent`: the ResponseId of the response.
- `variable`: the URN of the DDI variable.
- `row`: the row of a roster or a loop, from 1. The column is empty for other variables.
- `value`: a code of the variable, a number or text. A ticked select-all option has the
  code that the DDI gives to a tick.

A blank cell gives no line, because the export cannot tell "not asked" from "not ticked".
A long file does not need a column for each round of each loop. Thus, a tool can compare
two files (for example real and synthetic responses) one variable at a time. The format is
our own.

**Caution: open the output as data (in R, Python or a spreadsheet's import), not with a
double click. A text answer can hold a formula, and a spreadsheet can run it.**

The command reads the DDI in `<name>.json` to get the codes of each variable. It refuses a
`<name>.json` that is not the DDI that the map was made from. It reads local files only.

The command matches each column by the ImportId in row 3, not by the column name. Thus, a
column that you rename in Qualtrics is still read. The command keeps Survey Preview
responses and test responses. Remove them in Qualtrics before you export, if you do not
want them.

The command writes findings on stderr, at their line in the export and their column. A
finding never shows a response value. If a column has the same problem in many rows, the
command writes one finding with the first line and the number of rows. Each error makes the
command exit with 1. The command still writes the values that it can read.

- `responses-unmapped-column` (warning): the map does not name the column of a question.
- `responses-missing-column` (warning): the export has no column for an entry of the map.
- `responses-not-a-code` (error): the value is not a code of the variable, or not a number
  in the range that the DDI gives.
- `responses-not-a-tick` (error): a select-all cell is not `1` and is not blank.
- `responses-provenance`: the `qretools_instrument` or `qretools_ddi` field of a response is
  not the same as in the map (error). A different `qretools_version` is a note.
- `responses-respondent` (error): a row has no ResponseId, or has the ResponseId of an
  earlier row.
- `responses-row` (error): a row has more or fewer cells than the header.
- `responses-duplicate` (error): two columns give one variable, in one row, for one
  respondent.
- `responses-import-id`, `responses-unknown-variable` and `responses-unreadable`: the
  command cannot read a header, a variable or the file.

The command reads the columns of a Qualtrics loop as `1_<ImportId>` to
`<rounds>_<ImportId>`. This form is not yet tested with a real export of a loop.

## Read a data file

`responses` also reads a data file, for example a published data release. The data file
must be CSV, with one header row. A column map tells the command which DDI variable each
column records. Thus, the answers of a data file and the answers of a Qualtrics export have
the same form: one line for each value, with the URN of the variable.

```sh
qretools responses data.csv --map maps/wave1-ddi-release.columns.json --ddi dist/instruments/wave1.json -o wave1-answers.csv
```

The map is JSON. Its name ends in `-ddi-<source>.columns.json`, where `<source>` is a short
name for the data (letters and digits). The `source` field of the map gives the same name.
If the field is missing, or if it is not the name in the file name, the command refuses the
map. The command reads `qsf` as a QSF column map. It reads all other sources as the map of a
data file:

```json
{
  "source": "release",
  "ddi": "sha256:3f5a…",
  "respondent": "ID",
  "values": { "-98": "D", "-99": "N", "-100": null },
  "columns": [
    { "column": "TENURE", "variable": "urn:ddi:org.example:instrument-wave1.var-tenure:3" },
    { "column": "AGE", "variable": "urn:ddi:org.example:instrument-wave1.var-age:3" },
    { "column": "MODE", "variable": "urn:ddi:org.example:instrument-wave1.var-mode:3", "values": { "9": "4" } },
    { "column": "INCOME", "variable": "urn:ddi:org.example:instrument-wave1.var-income:3", "filtered": true },
    { "column": "PERSONS", "variable": "urn:ddi:org.example:instrument-wave1.var-persons:3", "censored": { "8": "8 or more" } }
  ]
}
```

- `source`: the short name of the data, as in the name of the map.
- `ddi`: the SHA-256 digest of the DDI that the map was made from. If the map has a digest,
  the command refuses a different DDI.
- `respondent`: the header of the column that identifies each respondent.
- `values`: the translations for all columns, from a value in the data file to a code of
  the variable. `null` means "no answer": the command writes no line for the value, as
  for a blank cell. Use `null` for a code that means "not asked".
- `columns`: for each column, its header, the URN of its DDI variable and, if necessary,
  its own `values`. A translation in a column's `values` replaces the same translation in
  the map's `values`. To read a value as it is in one column only, translate it to itself
  (`"-98": "-98"`).
- `filtered`: `true` if the variable is filtered from the data file (see below). The
  command reads no value from the column. It writes one note for the column. The file
  does not have to have the column.
- `censored`: the values that mean a range, not a number, each with what it means. For
  example, `8` can mean "8 or more" (a top code), and `17` can mean "17 or younger" (a
  bottom code). The command writes no line for such a value. It writes one note for the
  column, and reads all other values of the column.

**Filtered.** A variable is filtered from a data file when the data file does not hold
its values at the level of access that you have. The publisher can filter a variable, for
example to protect respondents. You can filter a variable too, for example when the data
file holds the values in a different form (broad groups, not the codes of the variable).
Mark a filtered variable `"filtered": true`. Do not remove it from the map: the note
shows that the variable has no values from this file.

To read a data file, do these steps:

1. Convert the data file to CSV, with one header row. Write each code as the variable
   writes it, for example `1`, not `1.0`.
2. Keep only the rows of one instrument, for example the rows of one year. The command
   reads all rows of the file.
3. Run `build` to get the DDI of the instrument.
4. Write the map. Write each header as it is in the CSV: the command does not change the
   case of a header.
5. Put the digest of the DDI in `ddi` (`shasum -a 256 <name>.json`, then add `sha256:`
   before it).
6. Run `qretools responses <data.csv> --map <the map>`. If `<name>.json` is not in the
   folder of the map, add `--ddi <the DDI>`.
7. **Caution: do not write the output into `dist/` or into a folder that CI publishes.
   The output holds the responses.**

If `build` changes the DDI, the digest of the DDI changes. Then write the new digest in
the map.

The output is the same as in "Read the responses". A number is read only if it is in the
range that the DDI gives. This check applies to a Qualtrics export too. The command writes these findings, in addition to those of
"Read the responses":

- `responses-missing-column` (warning): the file has no column with a header that the map
  names. The command writes one warning for all of these columns.
- `responses-header` (error): the file has two or more columns with a header that the map
  names. The command reads none of them.
- `responses-unmapped-column` (note): the map does not name a column of the file. The
  command writes one note for all of these columns.
- `responses-unreadable` (error): the file has no header row, or it does not have exactly
  one column with the header in `respondent`.
- `responses-filtered` (note): the map marks the column `filtered`. The command reads no
  value from it.
- `responses-censored` (note): a value of the column is in its `censored` list. The command
  writes no line for it.

An input of an instrument has the missing values of the questions that the instrument
asks. Thus, a data file can give "Don't know" (or another missing value) for an input.

## Filter the answers by access level

`filter` keeps the answers that a person at one access level can see. It reads the
answers as `responses` writes them, and the DDI that the answers refer to:

```sh
qretools filter wave1-answers.csv --ddi dist/instruments/wave1.json --access public -o wave1-public.csv
qretools filter --ddi dist/instruments/wave1.json   # list the access policies and their levels
```

The command keeps the answers to the variables at the level and at each more open level.
It removes the other answers, by the URN of the variable. The output has the same form as
the input. Thus, real answers and synthetic answers are filtered in the same way.

The command uses only the DDI. A workspace that lists access levels has an access policy:
its levels in their order. In the DDI, a policy is a code list. Its ID spells the levels,
for example `access-public-restricted`, and the code of each level is its rank, from 1 for
the most open level. Each variable of a question has an embargo. The embargo has the name
of the level, and the URN of the policy of the workspace of the question. This applies at
the most open level too. Thus, the level of a question from another workspace is always
read against the policy of its own workspace, never against the policy of the instrument.

The list of the policies shows each policy, then each level with the number of variables
at that level:

```text
urn:ddi:org.example:access-public-restricted.codes:1
  public 12
  restricted 3
```

To filter answers, do these steps:

1. Run `qretools filter --ddi <file.json>` to see the policies and their levels.
2. Run `qretools filter <answers.csv> --ddi <file.json> --access <level> -o <file>`.
3. Read the notes on stderr. Each `filter-removed` note gives the name and the URN of one
   variable that the command removed. A note never shows a value.

The answers and the DDI are one unit. If the command refuses one variable, it refuses all
the answers. It writes nothing and exits with 1, in these conditions:

- `filter-unknown-level`: a policy in the DDI has no level with that name. The message
  gives the levels of that policy.
- `filter-no-levels`: the DDI has no access levels.
- `filter-unknown-variable`: the answers have a variable that the DDI does not have. The
  level of that variable is not known.
- `filter-untraced`: the level of a variable cannot be traced to one policy. For example,
  the variable has no embargo, the embargo has no policy, or the policy does not have the
  level of the embargo.
- `filter-levels`: the command cannot read a policy. The command reads each code list
  with an ID of the form `access-<levels>.codes` as a policy.
- `filter-unreadable`: the answers are not in the form that `responses` writes.
- `filter-leak`: after the filter, an answer above the level is still in the output. This
  is a bug in QREtools. Please report it.

The command does not compare the answers with the DDI file that `responses` read. Use the
DDI from `build`: its URNs have versions, so answers from a different build do not match
its variables. The DDI from `export` has version 1 for each item.

**Caution: a computed value (for example, a value that an instrument computes from a
restricted answer) has no level. The command does not remove it.**

## Codebook

`codebook` writes the codebook of the DDI that `export` writes, and refuses when `export`
does. It's one HTML page with its style inside, no script and nothing fetched, so it can
be opened from a file, attached or published as it is. Each variable shows its name and
label, its question's words, its codes (missing values last) and, where it has them, its
format, universe and concept. Each has its own anchor
(`codebook.html#org.example:variable-consent`), which stays the same when its version
changes. The title is "Codebook": a workspace has no name of its own yet.

Given a file, `codebook` reads it as DDI-Lifecycle 4.0 JSON, from any tool. So the
codebook of one instrument, with its map after the contents and its routing beside each
question, comes from its export:

```sh
qretools instrument export instruments/wave1.yaml -o wave1.json
qretools codebook wave1.json -o wave1.html
```

In CI, make the codebook of what `build` versioned. Its anchors match every earlier
build's, since an anchor leaves out the version:

```sh
qretools build . -o dist
qretools codebook dist/ddi.json -o dist/codebook.html --strict
```

If the DDI refers to something it doesn't contain, the page shows it, and stderr says it
as `check` says a finding (`ddi.json: error: <where>: <message> [codebook-dangling]`).
With `--strict` the command fails, but the page is still written.

## Paths

`paths` writes a report of an instrument's paths: one HTML page saying how many ways there
are through its routing, how many questions each asks, and which questions each reaches.
The page says how it counts.

```sh
qretools instrument export instruments/wave1.yaml -o wave1.json
qretools paths wave1.json -o wave1-paths.html
```

It reads any DDI-Lifecycle 4.0 JSON with an instrument in it. What it can't read is said
on stderr as `check` says a finding.

## Output

`check` writes `path:line:col: level: message [code]`, as compilers do, so editors and CI
can annotate it. `export` writes the DDI of every question in one document. It refuses
when the DDI would be wrong: no agency, two things sharing one DDI name, or a document
the official schema rejects. In this repository, `pnpm qretools check <dir>` runs it.

## Development

In this repository it runs from source under Node 26, which strips TypeScript's types, so
there's no build step. The published package is a bundle (`pnpm --dir packages/cli bundle`,
rolldown): `dist/qretools.js` with the core, the Qualtrics export and their dependencies
inside, since Node won't strip types under `node_modules`. The DDI schema is in a chunk of
its own, loaded only to export. It depends on nothing.

**Releasing.** Set `version` in `packages/cli/package.json`, merge, then push a tag
`cli-v<version>` (`git tag cli-v2.0.0-alpha.1 && git push origin cli-v2.0.0-alpha.1`).
`.github/workflows/release-cli.yml` checks the repository, checks that the tag names that
version, packs, installs the tarball and runs it, then stages it with provenance through
npm's trusted publishing (no token). Staged isn't public: a maintainer approves it with
2FA, `npm stage list qretools` then `npm stage approve <id>` (or on npmjs.com). Every
version goes to the dist-tag `latest`, prereleases included, so `npx qretools` runs the
newest (npm requires the tag named for a prerelease). A published version can't be
replaced: fix forward with the next one.

This is the one package that knows both the core (`@qretools/core`) and Qualtrics
(`@qretools/qualtrics`). The core knows nothing of any export target.
