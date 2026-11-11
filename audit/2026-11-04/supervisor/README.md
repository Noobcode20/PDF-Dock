# Supervisor evidence

`probe.mjs` runs four engine probes against the working source. From the project root: `node audit/2026-11-04/supervisor/probe.mjs`. It creates only its JSON result and in-memory test PDFs.

`ui-observations.json` records actual browser-control probes separately from engine tests. The form crash screenshot and generated fixtures are included. No user document was used.

`tested-source.tar.gz` contains the isolated source used for UI probes (November 4 snapshot), without node_modules, public binary assets or Vite caches. To recreate that runtime, extract into an empty scratch folder and provide the project's matching node_modules and public assets. The copied Vite config uses a separate cacheDir to avoid shared optimizer-cache races.

`source-manifest.json` identifies the original UI source snapshot. `reviewed-source-manifest.json` records hashes of the sources cited when the consolidated report was assembled on November 5. The working checkout changed during this task, so future verification should recheck affected sources.

Earlier scoped reports are unfiltered agent output; use ../REPORT.md as the authoritative reviewed finding list.
