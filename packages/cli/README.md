# The `qretools` command

For a workspace checked out on disk, in CI or at a terminal:

```sh
qretools check path/to/workspace            # findings, one per line; exit 1 on anything to fill in or fix
qretools check path/to/workspace --strict   # warnings fail too
qretools export path/to/workspace -o questions.json   # its questions' DDI, validated
qretools build path/to/workspace             # its last commit's DDI, versioned from git history, in path/to/workspace/dist/ddi.json
```

A workspace is one folder: `workspace.yaml` (its settings), `questions/<folder>/`, the
shared folders (`scales/` and so on), `missing.yaml`, `select_all.yaml` and
`instruments/`. `check` reports the findings of its questions and shared files and of
every instrument (read against its own workspace, written `../`, under the agency
`workspace.yaml` gives its questions too), and notes YAML files it reads as nothing.

A workspace in another repository (`owner/repo@v1`, or `owner/repo/folder@v1`) is read at
that tag with your own `git`, so whatever credentials git has reach a private
repository. Only `refs/tags/v1` is fetched, never a branch of that name, shallow and
only its folder, into a cache by tag and folder (`$XDG_CACHE_HOME/qretools`, else
`~/.cache/qretools`) beside the commit it resolved to; later runs read the cache. A tag
is immutable by convention only: to read one that was moved, delete its entry in the
cache. In CI, a private one needs git credentials for it, such as `GITHUB_TOKEN` given
to git (`git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf https://github.com/`)
or a deploy key.

For one instrument, `qretools instrument check <file>` and `qretools instrument export
<file> --agency <agency>`: it reads its own workspace (`../`, the folder above it) and
others at their tags; `--bank alias=dir` reads an alias written as `owner/repo@v1` from a
directory instead, to work offline. Any other local address is refused.

`qretools instrument export <file> --qsf` writes the instrument as a Qualtrics survey
(QSF) made from its DDI, to import under Projects → Create project → Survey. Everything
Qualtrics can't run as the DDI says is reported at its line, and an error writes nothing.

`build` is `export` with real versions. Each item's DDI version counts the changes, along
the first-parent history of HEAD, to its file and to every shared file it names (so a
question moves when its scale does); its date is that commit's, its git blob a UserID.
It builds the last commit, not the working tree (uncommitted changes are left out, and
said to be), needs the whole history (a shallow clone is refused: `fetch-depth: 0` in
CI), and writes `<outdir>/ddi.json`, `-o` naming the folder (default `<dir>/dist`).

`check` writes `path:line:col: level: message [code]`, as compilers do, so editors and
CI annotate it. `export` writes every question's DDI items in one document, and refuses
when it would be wrong: no declared agency, two items under one identity, or a document
the official schema rejects. In this repository, `pnpm qretools check <dir>` runs it.

It runs from source under Node 26, which strips TypeScript's types; no build. A copy
installed under `node_modules` would need one, since Node won't strip types there.

It is the one package that knows both the core (`@qretools/core`) and the Qualtrics
export (`@qretools/qsf`): the core knows nothing of any export target.
