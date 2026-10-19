# @qretools/qsf

An instrument's DDI-Lifecycle 4.0, read back and written as a Qualtrics survey (QSF). It
reads only DDI, never the instrument, so the DDI stays the record of the survey that was
fielded; and it knows Qualtrics, so the core doesn't.

```ts
import { placeFindings } from "@qretools/core";
import { qsfOf, qsfTime } from "@qretools/qsf";

const made = qsfOf(instrument.ddi, { name: "households", created: qsfTime(new Date()) });
// made.kind is "made" (made.qsf, to import into Qualtrics) or "refused" (made.errors)
placeFindings(made.findings, instrument.places); // each finding at its step in the YAML
```

Anything Qualtrics can't run as the DDI says is a finding, and any error refuses the
survey. How Qualtrics behaves was measured in a Qualtrics account before the export relied
on it; `fixtures/households.qsf` is the golden file, a survey Qualtrics imported and ran
as written (2026-10-18), and a test compares the export with it. Change it only after
importing the new survey. One exception, the owner's call: after that import the households
rent warning was reworded without its pipe (the shape the import had measured), and the
golden file was regenerated without importing it again.
