The library's own sample bank (`bank/`): the example bank a new workspace starts with, as
JHUCities/qretools-template ships it at `banks/example`. The example instrument is written
for it (`src/instrument/example.ts`), so the two change together; the tests read it with
`readBank` and check it with `bankOf`.
