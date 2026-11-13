# @qretools/qualtrics

Turns an instrument's DDI-Lifecycle 4.0 into a Qualtrics survey (QSF). It reads only the
DDI, never the instrument, so the DDI stays the record of the survey that was fielded.
Only this package knows Qualtrics; the core doesn't.

```ts
import { placeFindings } from "@qretools/core";
import { qsfOf, qsfTime } from "@qretools/qualtrics";

const made = qsfOf(instrument.ddi, { name: "households", created: qsfTime(new Date()) });
// made.kind is "made" (made.qsf, to import into Qualtrics) or "refused" (made.errors)
placeFindings(made.findings, instrument.places); // each finding at its step in the YAML
```

Anything Qualtrics can't run as the DDI says is a finding, and any error stops the
export. Each Qualtrics behaviour the export relies on was first tested in a Qualtrics
account. `fixtures/households.qsf` is the golden file: a survey Qualtrics imported and ran
as written (2026-10-18). A test compares the export with it. Change it only after
importing the new survey. One exception, the owner's call: after that import, the
households rent warning was reworded to drop its pipe (the import had tested it with the
pipe), and the golden file was regenerated without importing it again.

## Responses

The package also reads a Qualtrics response export (CSV, "Export values", multi-value
fields split into columns) with the QSF column map. `exportMap` matches each column by the
ImportId in row 3, and checks the `qretools_*` fields of each response against the map. It
gives a `ResponseMap`. The core's `readResponses` then reads the rows into answers by DDI
variable URN, and gives each respondent the start and end of the interview from `StartDate`
and `EndDate` (in the time zone of row 3: `Z` or an offset, else a finding). The core knows no source, so another source (a published data file) can give
its own map. Anything the package cannot read is a finding, with its line and column.

```ts
import { datasetOf, readResponses } from "@qretools/core";
import { exportMap } from "@qretools/qualtrics";

const read = exportMap(csv, columnMap, ticked); // ticked: the tick code of each select-all option, from the DDI
// read.map is absent when the file can't be read at all (read.findings says why)
if (read.map !== undefined) {
  const { respondents, answers, findings } = readResponses(read.header, read.rows, read.map, representations);
  const dataset = datasetOf({ name, agency, respondents, answers }); // the dataset as DDI
}
```

`qretools responses` does this for a file (`packages/cli/README.md`).
