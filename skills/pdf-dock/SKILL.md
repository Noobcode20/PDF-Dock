---
name: pdf-dock
description: Use PDF Dock's local command line to inspect, search, create, edit, and process PDF files.
---

# PDF Dock CLI

Use the `pdf-dock` command for local PDF work. Run `pdf-dock tools` to discover supported tools and schemas. Send JSON requests through stdin or a request file; for example:

```sh
printf '%s\n' '{"command":"inspect","file":"document.pdf"}' | pdf-dock inspect
```

Use `pdf-dock run` with a tool ID from `pdf-dock tools`, `pdf-dock search` to search text, `pdf-dock edit` for editor operations, and `pdf-dock create` to create a PDF. Outputs remain local. Avoid overwriting existing files unless the request explicitly sets `force: true`.

Direct commands are also supported:

```sh
pdf-dock inspect document.pdf --json
pdf-dock search document.pdf "total" --json
pdf-dock create -o blank.pdf --options '{"pageCount":2}' --json
pdf-dock run compress-pdf document.pdf -o small.pdf --json
```

Use `--json` for machine output, `--pretty` for indented JSON, or `--human` for terminal summaries. `--options` takes a JSON object; `edit --operations` takes a JSON array. Use `--request PATH` (or `-` for stdin) for complete requests. `--force` permits replacing outputs. Exit codes are 0 success, 1 processing failure, 2 invalid usage. Run `--help` for examples. Do not infer editor operation types from this guide; consult the shared editor implementation.
