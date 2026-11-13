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
qretools responses export.csv --map dist/instruments/wave1-ddi-qsf.columns.json --answered-by PopulationGroup -o wave1.json  # a Qualtrics export, as a DDI dataset
qretools responses data.csv --map wave1-ddi-release.columns.json --ddi wave1.json \
  --asked-by Interview.FaceToFace --answered-by ResearchData.Published -o release.json  # a data file, as a DDI dataset
qretools dataset export wave1-data.json --csv --ddi wave1.json     # a dataset's values, one line per value
qretools dataset export wave1-data.json --provenance --ddi wave1.json --access public  # without its values, at a level
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
  folder, it writes the Qualtrics survey of the instrument, `<name>.qsf`, and its QSF
  column map, `<name>-ddi-qsf.columns.json`. If Qualtrics cannot run an instrument,
  `build` gives a warning. It then writes no survey and no QSF column map for that
  instrument.

`--tag-message <file>` also writes the text for a release's tag: a line, a blank line,
then each file's version, date and blob as JSON. Tag the built commit with it, verbatim,
so git keeps it whole: `git tag -a --cleanup=verbatim -F <file> v2 HEAD`. A workspace can
do this in a workflow it runs by hand with the tag's name (qretools-gss's `release.yml`
is one). The tag points at the default branch's own commit, and only the tag is pushed.

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
and `01`), the QSF column map does not read the two options, and `build` gives a
`qsf-unmapped` warning.

**Caution: do not use the code `Infinity`, or a number that is too large for Qualtrics
(for example `1e999`). Qualtrics writes nothing for this option, and the answer is
lost.** `build` gives a `qsf-unmapped` warning for this code.

A QSF column map from qretools 2.0.0-alpha.9 or earlier does not give these values. To
get them, run `build` again. The QSF and its QIDs do not change, so a survey that
collects responses can use the new map.

## Read the responses

`responses` reads a Qualtrics response export with its QSF column map. It writes a
dataset: a DDI-Lifecycle 4.0 document that holds the responses.

```sh
qretools responses export.csv --map dist/instruments/wave1-ddi-qsf.columns.json --answered-by PopulationGroup -o wave1-data.json
```

To read an export, do these steps:

1. Do the steps in "Export from Qualtrics" to get the export.
2. Find the QSF column map of the survey. `build` writes it in `<outdir>/instruments/`.
3. Make sure that `<name>.json` is in the same folder as the map. `build` writes the two
   files together.
4. Run `qretools responses <export.csv> --map <name>-ddi-qsf.columns.json -o <dataset.json>`.
   If the command asks for `--answered-by`, add it (see "The provenance").
5. **Caution: do not write the output into `dist/` or into a folder that CI publishes.
   The output holds the responses.** Without `-o`, the command writes the dataset to
   stdout.

The dataset holds a `DataSet` item. Its `ItemSet` has one `ItemValue` for each value:

- `VariableReference`: the DDI variable that records the value. The dataset refers to the
  variable in the DDI of the instrument. It does not hold a copy of the variable.
- `RecordReference`: the ResponseId of the response.
- `Value`: a code of the variable, a number or text. A ticked select-all option has the
  code that the DDI gives to a tick.

The dataset also holds three variables of its own:

- `respondent`: the ResponseId. Each respondent has one value of this variable, also a
  respondent with no answers. The `DataSet` identifies each respondent with it.
- `start` and `end`: the time when the interview started and ended. The command reads
  them from `StartDate` and `EndDate`, in the time zone that row 3 gives.

The dataset also holds its provenance (see "The provenance").

The dataset gets its name from the file name of `-o`, without `.json`. Without `-o`, it
gets the name of the instrument: `<name>` in the name of the map. The name can have only letters, digits, `-` and `_`. The IDs
of the dataset and of its variables start with `dataset-<name>`. The dataset has the DDI
agency of the variables in the map.

The command sorts the values by respondent, then by the URN of the variable. Thus, the
same input always gives the same file. If the file of `-o` holds the same dataset, the
command writes nothing and says `unchanged`. If the file of `-o` holds something else, the
command refuses to replace it. Remove the file, or write to another file.

A blank cell gives no value, because the export cannot tell "not asked" from "not ticked".
To get the values as CSV, see "Export a dataset".

The dataset cannot yet hold the rows of a roster or a loop. If the export has an answer in
a row, the command writes no dataset.

The command reads the DDI in `<name>.json` to get the codes of each variable. If
`<name>.json` is not the DDI that the map was made from, the command gives a warning and
continues. The dataset records the two digests. The command reads local files only.

The command matches each column by the ImportId in row 3, not by the column name. Thus, a
column that you rename in Qualtrics is still read. The command keeps Survey Preview
responses and test responses. One dataset describes one collection, so one export must
hold one kind of response. Export each kind apart.

The command writes findings on stderr, at their line in the export and their column. A
finding never shows a response value. If a column has the same problem in many rows, the
command writes one finding with the first line and the number of rows. Each error makes the
command exit with 1. The command still writes the values that it can read.

- `responses-unmapped-column` (warning): the map does not name the column of a question.
- `responses-missing-column` (warning): the export has no column for an entry of the map.
- `responses-not-a-code` (error): the value is not a code of the variable, or not a number
  in the range that the DDI gives.
- `responses-not-a-tick` (error): a select-all cell is not `1` and is not blank.
- `responses-provenance`: the `qretools_instrument` field of a response is not the same
  as in the map (error). A different `qretools_ddi` is a warning: the dataset records each
  digest. A different `qretools_version` is a note. A different DDI given to the command is
  a warning too.
- `responses-respondent` (error): a row has no ResponseId, or has the ResponseId of an
  earlier row.
- `responses-row` (error): a row has more or fewer cells than the header.
- `responses-duplicate` (error): two columns give one variable, in one row, for one
  respondent.
- `responses-time` (error): the command cannot read the time of an interview. The time
  zone in row 3 is not `Z` or an offset such as `-05:00`, or a cell is not a time such as
  `2026-11-12 23:15:41`. The command still writes the values.
- `responses-import-id`, `responses-unknown-variable` and `responses-unreadable`: the
  command cannot read a header, a variable or the file.

These errors stop the command before it writes the dataset:

- `responses-dataset`: an answer is in the row of a roster or a loop.
- `responses-agency`: the variables in the map do not have one DDI agency.
- `responses-exists`: the file of `-o` holds something that is not this dataset.
- `responses-collection`: the responses have different `Status` or `DistributionChannel`
  values, for example test responses and real responses.
- `responses-facts` (exit 2): an option is necessary, or the option gives a fact that the
  source gives (see "The provenance").

The command reads the columns of a Qualtrics loop as `1_<ImportId>` to
`<rounds>_<ImportId>`. This form is not yet tested with a real export of a loop.

## The provenance

The dataset holds its provenance beside its values. The provenance holds no value and no
respondent:

- A `StudyUnit`. All the other items of the provenance are found from it.
- A `DataCollection` with one `CollectionEvent`:
  - `InstrumentReference`: the instrument of the DDI, with its version.
  - `DataCollectionDate`: the earliest start and the latest end of the interviews. No
    option gives the dates.
  - `ModeOfCollection`: how the respondents were asked, as a term of the DDI vocabulary
    ModeOfCollection.
  - `DataSource`: who answered, as a term of the DDI vocabulary DataSourceType.
  - For a Qualtrics export, a `Methodology` names the software, Qualtrics.
- A `PhysicalInstance` for the dataset. It refers to the `DataSet`. Its `DataFingerprint`
  (`Type` `data`) is the SHA-256 digest of the CSV view (`dataset export --csv`). The CSV
  view holds the answers only, not the respondents or the times of the interviews. The CSV
  view is sorted, so the same values always give the same digest, in each file format.
- A `PhysicalInstance` for the source file, with its SHA-256 digest (`Type` `dataFile`)
  and its size. It also records the DDI digests that the source names (`qretools_ddi`).
- An `OtherMaterial` for the map and one for the DDI, each with its SHA-256 digest
  (`UserID`) and its size. The map also records the DDI digest that it names.
- Two `VariableGroup` items: `present` (each variable with a value, also `respondent`,
  `start` and `end`) and `not-in-source` (each variable of the instrument that the map
  does not read).

The command gets each fact of the collection in this sequence:

1. If the source gives the fact, the command uses it.
2. If the source does not give the fact, an option must give it: `--asked-by <term>` or
   `--answered-by <term>`.
3. If no option gives the fact, the command stops. The message names the option.

If an option gives a fact that the source gives, the command stops. It writes nothing.

| Source | The source gives | The options that you must give |
|---|---|---|
| Qualtrics test responses (`Status` 2, channel `test`) | asked by `Simulation`, answered by `Other` ("generated by the survey platform") | none |
| Qualtrics responses on an anonymous link or by email (`Status` 0) | asked by `SelfAdministeredQuestionnaire.CAWI` | `--answered-by` |
| Other Qualtrics responses | nothing | `--asked-by`, `--answered-by` |
| A data file | nothing | `--asked-by`, `--answered-by` |

The command does not check a term against the vocabulary.

## Read a data file

`responses` also reads a data file, for example a published data release. The data file
must be CSV, with one header row. A column map tells the command which DDI variable each
column records. Thus, the answers of a data file and the answers of a Qualtrics export have
the same form: a dataset, with the URN of the variable of each value.

```sh
qretools responses data.csv --map maps/wave1-ddi-release.columns.json --ddi dist/instruments/wave1.json -o wave1-release.json
```

The map is JSON. Its name ends in `-ddi-<source>.columns.json`, where `<source>` is a short
name for the data (letters and digits). The command reads `qsf` as a QSF column map. It
reads all other names as the map of a data file:

```json
{
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

- `ddi`: the SHA-256 digest of the DDI that the map was made from. If the map has a digest,
  and the DDI is different, the command gives a warning. The dataset records the two digests.
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
6. Run `qretools responses <data.csv> --map <the map> --asked-by <term> --answered-by <term>`.
   If `<name>.json` is not in the folder of the map, add `--ddi <the DDI>`.
7. **Caution: do not write the output into `dist/` or into a folder that CI publishes.
   The output holds the responses.**

If `build` changes the DDI, the digest of the DDI changes. Then write the new digest in
the map.

The output is the same as in "Read the responses". A data file gives no time of an
interview, so the dataset has no `start` or `end` variable. A number is read only if it is in the
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
  writes no value for it.

An input of an instrument has the missing values of the questions that the instrument
asks. Thus, a data file can give "Don't know" (or another missing value) for an input.

## Export a dataset

`dataset export` writes a view of a dataset. Give `--csv` or `--provenance`, and `--ddi`
with the DDI that the dataset was made from. The command compares the SHA-256 digest of
that file with the digest that the dataset records. If the digests are different, the
command writes nothing (`dataset-ddi`). The command gets the access level of each
variable from this DDI. See "Access levels" below.

`--provenance` writes the dataset without its values: the `DataSet` item without its
`ItemSet`, and the provenance. The output holds no value and no respondent. Thus, you can
publish it. `dataset export --csv` refuses it, because it holds no values.

```sh
qretools dataset export wave1-data.json --provenance --ddi wave1.json --access public -o wave1-provenance.json
```

`--csv` writes the values of a dataset as long CSV, for analysis tools:

```sh
qretools dataset export wave1-data.json --csv --ddi wave1.json -o wave1-answers.csv
```

```csv
respondent,variable,row,value
R_1,urn:ddi:org.example:instrument-wave1.var-modes_b:3,,1
R_1,urn:ddi:org.example:instrument-wave1.var-tenure:3,,2
```

To export a dataset, do these steps:

1. Do the steps in "Read the responses" to get the dataset.
2. Run `qretools dataset export <dataset.json> --csv --ddi <ddi.json> -o <file.csv>`. If
   the DDI defines access levels, also give `--access <level>`.
3. **Caution: do not write the output into `dist/` or into a folder that CI publishes.
   The output holds the responses.** Without `-o`, the command writes the CSV to stdout.

The output is long CSV (one value on one line), in four columns:

- `respondent`: the respondent, as the source writes it.
- `variable`: the URN of the DDI variable.
- `row`: the row of a roster or a loop, from 1. The column is empty for other variables.
- `value`: a code of the variable, a number or text.

The lines are sorted by respondent, then by the URN of the variable. The output does not include the variables of
the dataset (`respondent`, `start` and `end`). A long file does not need a column for each
round of each loop. Thus, a tool can compare two files (for example real and synthetic
responses) one variable at a time. The format is our own.

**Caution: open the output as data (in R, Python or a spreadsheet's import), not with a
double click. A text answer can hold a formula, and a spreadsheet can run it.**

If the file is not a dataset that `responses` wrote, the command refuses it
(`dataset-unreadable`).

### Access levels

The dataset holds all the values. The command never filters the dataset. It filters
only the view:

- If the DDI defines access levels, you must give `--access <level>`. The view keeps the
  values of the variables at that level and at each more open level.
- If the DDI defines no access levels, the command refuses `--access`.

The command uses only the DDI. A workspace that lists access levels has an access policy:
its levels in their order. In the DDI, a policy is a code list. Its ID spells the levels,
for example `access-public-restricted`, and the code of each level is its rank, from 1 for
the most open level. Each variable of a question has an embargo. The embargo has the name
of the level, and the URN of the policy of the workspace of the question. This applies at
the most open level too. Thus, the level of a question from another workspace is always
read against the policy of its own workspace, never against the policy of the instrument.

The variables of the dataset (`respondent`, `start` and `end`) are not questions. They
can identify a respondent. Thus, they are at the most closed level of each policy. Below
that level:

- The CSV view numbers the respondents from 1, in the order of their identifiers, and
  does not show the identifiers.
- The provenance view does not show the dates of the collection.

The provenance view records the level (an `InformationClassification` item) and a
`VariableGroup` named `removed-by-access` with the variables that it removed. The
`present` group does not include them. The "data" fingerprint is not changed: it is the
fingerprint of the full dataset.

To export a view at a level, do these steps:

1. Run `qretools dataset export <dataset.json> --csv --ddi <ddi.json>`. If the DDI defines
   access levels, the command refuses and gives the levels of each policy.
2. Run `qretools dataset export <dataset.json> --csv --ddi <ddi.json> --access <level> -o <file>`.
3. Read the notes on stderr. Each `dataset-access-removed` note gives the name and the
   URN of one variable that the command removed. A note never shows a value.

The values and the DDI are one unit. If the command refuses one variable, it refuses all
the values. It writes nothing and exits with 1, in these conditions:

- `dataset-access-level-required`: the DDI defines access levels, and you did not give
  `--access`. The message gives the levels of each policy.
- `dataset-access-unknown-level`: a policy in the DDI has no level with that name. The
  message gives the levels of that policy.
- `dataset-access-no-levels`: the DDI has no access levels, and you gave `--access`.
- `dataset-access-unknown-variable`: the dataset has a variable that the DDI does not have.
  The level of that variable is not known.
- `dataset-access-untraced`: the level of a variable cannot be traced to one policy. For
  example, the variable has no embargo, the embargo has no policy, or the policy does not
  have the level of the embargo.
- `dataset-access-levels`: the command cannot read a policy. The command reads each code
  list with an ID of the form `access-<levels>.codes` as a policy.
- `dataset-access-leak`: after the filter, a value above the level is still in the view.
  This is a bug in QREtools. Please report it.

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
