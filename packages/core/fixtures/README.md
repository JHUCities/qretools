The library's own samples, each a workspace.

`bank/`: the example questions a new workspace starts with, in `questions/example/`, and
the shared files they name, as JHUCities/qretools-template ships them. The example
instrument (`src/instrument/example.ts`) is written for them, so change the two together.
The tests read the folder with `readWorkspace` and check it with `bankOf`.

`households/`: a few questions and two instruments in `instruments/`. One uses every
part of the instrument language and asks its own workspace's questions
(`uses: hh: ../`). The other asks questions from a workspace in another repository, at a
tag.
