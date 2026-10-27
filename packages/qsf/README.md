# @qretools/qsf

Turns an instrument's DDI-Lifecycle 4.0 into a Qualtrics survey (QSF). It reads only the
DDI, never the instrument, so the DDI stays the record of the survey that was fielded.
Only this package knows Qualtrics; the core doesn't.

```ts
import { placeFindings } from "@qretools/core";
import { qsfOf, qsfTime } from "@qretools/qsf";

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
