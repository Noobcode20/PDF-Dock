# PDF Dock CLI

Run `pdf-dock` in a terminal to open the interactive workspace. Choose **a** to add a PDF (paste a path or drag it into the terminal), then choose an action. The menu supports inspecting, finding text, creating PDFs, rotating, deleting or extracting pages, adding watermarks, merging and compressing. **t** lists other tools and accepts their JSON options. Saved PDFs can be added back to the workspace for further edits. **q** exits. The workspace list is session-only; saved files remain on disk. This is a guided terminal editor; it does not display rendered PDF pages or support mouse-based page editing.

From this checkout, use `npm run cli -- --help` or `node bin/pdf-dock.mjs --help`.
In the desktop app, install the CLI from Settings and add the returned launcher directory to PATH. Reinstall the launcher after upgrading the app.

```sh
pdf-dock inspect report.pdf
pdf-dock search report.pdf "invoice total"
pdf-dock create -o blank.pdf --options '{"pageCount":2}'
pdf-dock run compress-pdf report.pdf -o smaller.pdf --options '{"level":"lossless"}'
pdf-dock tools --json
```

A terminal gets readable results. Redirected or piped stdout gets one JSON result. Use `--human`, `--json`, or `--pretty` to choose explicitly. Progress is opt-in with `--progress` and goes to stderr. Paths containing spaces must be quoted; use `--` before filenames starting with a dash.

For agents, discover command and tool option schemas using `tools --json`. Existing request workflows remain supported:

```sh
pdf-dock run request.json --pretty
pdf-dock run --request request.json --json
cat request.json | pdf-dock run --json
```

Requests are JSON objects containing `command` and that command's fields. `edit` accepts `--operations` with a JSON array; consult the shared editor engine for operation types. `--options` accepts a JSON object. Explicit output, options, operations, force and progress flags override the corresponding request values. Tool option validation is performed by the shared engine.

Output defaults to the current directory. Use `-o`/`--output` for a filename (single result) or directory (multiple results). Existing outputs are protected unless `--force` or request `force: true` is supplied.

Exit codes: **0** success, **1** processing/runtime failure, **2** invalid CLI usage or request JSON. Machine failures have `ok: false` and an `error` string on stdout. Human-mode failures go to stderr. Diagnostics from Electron may also appear on stderr.

The CLI requires PDF Dock's Electron runtime and a built renderer (`npm run build` for development). It runs the same engine as the desktop app. The packaged desktop installer supplies the app/runtime paths to the copied launcher.

Run `node scripts/test-cli.mjs` for the CLI contract tests. These use a mock engine to check parsing and stream behavior independently of Electron.
