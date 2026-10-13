The library's own samples, each a workspace root.

`bank/`: the example questions a new workspace starts with, in `questions/example/`, and
the shared files they name, as JHUCities/qretools-template ships them. The example
instrument is written for them (`src/instrument/example.ts`), so the two change together;
the tests read it with `readBank` and check it with `bankOf`.

`households/`: a small bank and, in `instruments/`, an instrument with every construct
of the language, using its own workspace (`uses: hh: ../`), and one using a bank in
another repository.
