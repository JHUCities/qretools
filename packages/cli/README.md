# The `qretools` command

For a workspace checked out on disk, in CI or at a terminal. Install it from npm (Node 22
or later), or run it without installing. `check` and `export` of a folder need only Node;
reading a workspace in another repository (`owner/repo@v1`) and `build` also need
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
can be moved, a commit can't: `instrument export` locks each tag the instrument reads at
the commit read, under `locked:` in its workspace's `workspace.yaml` (commit it with
the rest), as a build writes its lockfile (Cargo, npm), and saving an instrument in the
app does the same. A tag that names another commit than its lock is a `moved-tag`
warning on its `uses` line (in `check`, so `--strict` fails on it); the next export or
save re-locks it, saying `[WARNING]`, and the changed line in `workspace.yaml` is what
review sees. A tag with no lock (an instrument written by hand, never saved in the app
or exported) is an `unlocked-tag` warning in `check`. Locks are only ever set, never removed. Git's own guarantee, so it holds on
any forge. The command reads a tag from its cache, so a move shows where the cache is
fresh, as in CI; delete a tag's entry in the cache to read it again here. An
instrument outside a workspace, or in one without a `workspace.yaml`, exports, but its
tags aren't locked.

Its questions' DDI items say where they were read: UserAttributePairs
`git-repository`, `git-path`, `git-tag` and `git-commit` (the commit the tag named),
beside the file's `git-blob` UserID. Their versions come from the tag's message when it
is a release's (`build --tag-message`, below) and describes exactly the files at the tag;
otherwise they are 1, as nothing of its history is read, and a manifest that doesn't fit
is a warning on the `uses` line. One read from a folder with `--bank` says nothing of
where it came from. In CI, a private one needs git credentials for it, such as `GITHUB_TOKEN` given
to git (`git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf https://github.com/`)
or a deploy key.

For one instrument, `qretools instrument check <file>` and `qretools instrument export
<file>`, under its workspace's agency (`workspace.yaml`), or `--agency <agency>` for a
file outside a workspace's `instruments/`: it reads its own workspace (`../`, the folder
above it) and others at their tags; `--bank alias=dir` reads an alias written as
`owner/repo@v1` from a directory instead, to work offline. Any other local address is
refused.

`qretools instrument export <file> --qsf` writes the instrument as a Qualtrics survey
(QSF) made from its DDI, to import under Projects → Create project → Survey. Everything
Qualtrics can't run as the DDI says is reported at its line, and an error writes nothing.

`build` is `export` with real versions. Each item's DDI version counts the changes, along
the first-parent history of HEAD, to its file and to every shared file it names (so a
question moves when its scale does); its date is that commit's, its git blob a UserID.
It builds the last commit, not the working tree (uncommitted changes are left out, and
said to be), needs the whole history (a shallow clone is refused: `fetch-depth: 0` in
CI), and writes `<outdir>/ddi.json`, `-o` naming the folder (default `<dir>/dist`).
`--tag-message <file>` also writes a release's tag message: a line, a blank line, then
each file's version, date and blob as JSON. Tag the commit built with it, verbatim, so
git's cleanup leaves it whole: `git tag -a --cleanup=verbatim -F <file> v2 HEAD`. A
workspace can do that in a workflow it runs by hand with the tag's name (qretools-gss's
`release.yml` is one): the tag points at the default branch's own commit, and only the tag
is pushed.

`codebook` writes the codebook of the DDI `export` writes, refused as `export` refuses:
one HTML page with its style inside it, no script and nothing fetched, so it can be
opened from a file, attached or published as it is. Each variable has its name and
label, its question's words, its codes (missing values after the others) and, where it
has them, its format, universe and concept, and an anchor of its own (`codebook.html#org.example:variable-consent`)
that stays the same when its version changes. Its title is "Codebook": a workspace has
no name of its own yet. A codebook of one instrument (its routing beside each question)
isn't written yet.

`check` writes `path:line:col: level: message [code]`, as compilers do, so editors and
CI annotate it. `export` writes every question's DDI items in one document, and refuses
when it would be wrong: no declared agency, two items under one identity, or a document
the official schema rejects. In this repository, `pnpm qretools check <dir>` runs it.

In this repository it runs from source under Node 26, which strips TypeScript's types; no
build. The published package is a bundle (`pnpm --dir packages/cli bundle`, rolldown):
`dist/qretools.js` with the core, the Qualtrics export and their dependencies inside, as
Node won't strip types under `node_modules`, and the DDI schema in a chunk of its own,
loaded only to export. It depends on nothing.

**Releasing.** Set `version` in `packages/cli/package.json`, merge, then push a tag
`cli-v<version>` (`git tag cli-v2.0.0-alpha.1 && git push origin cli-v2.0.0-alpha.1`).
`.github/workflows/release-cli.yml` checks the repository, checks the tag names that
version, packs, installs the tarball and runs it, then stages it with provenance through
npm's trusted publishing (no token). Staged isn't public: a maintainer approves it with
2FA, `npm stage list qretools` then `npm stage approve <id>` (or on npmjs.com). Every version goes to the dist-tag `latest`, prereleases
included, so `npx qretools` runs the newest (npm requires the tag named for a prerelease). A published version can't be replaced: fix forward with the next one.

It is the one package that knows both the core (`@qretools/core`) and the Qualtrics
export (`@qretools/qsf`): the core knows nothing of any export target.
