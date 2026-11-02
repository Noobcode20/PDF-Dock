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
