The library's own samples, each a workspace.

`bank/`: the example questions a new workspace starts with, in `questions/example/`, and
the shared files they name, as JHUCities/qretools-template ships them. The example
instrument is written for them (`src/instrument/example.ts`), so the two change together;
the tests read it with `readWorkspace` and check it with `bankOf`.

`households/`: a few questions and, in `instruments/`, an instrument with every construct
of the language, using its own workspace (`uses: hh: ../`), and one using a workspace in
another repository at a tag.

`qsf/households.qsf`: the households instrument as a Qualtrics survey, the golden file. Qualtrics
imported and ran it as written (2026-10-18); a test compares the export with it, so a change
Qualtrics would see shows up as a diff. Change it only after importing the new survey.
