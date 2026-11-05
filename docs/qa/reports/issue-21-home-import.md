> Historical lane checkpoint. The integrated implementation and final parent verification are recorded in [ISSUE_SWEEP.md](../ISSUE_SWEEP.md) and [REAL_DOCUMENT_VERIFICATION.md](../REAL_DOCUMENT_VERIFICATION.md).

# Issue 21 Home import lane

Implemented Home Browse behavior for direct PDF selection. Browser file inputs accept multiple PDFs; Electron's native `openPdf` result array is converted to `File` objects and each selected document is opened in its own editor tab. Home drag/drop continues to pass multiple PDFs together into the editor. The New Document page's intentional recent/open flow remains unchanged.

Verification: `npm run build` passed. Build emitted existing Node module externalization and large chunk warnings. No Electron runtime picker interaction or end-to-end library persistence verification was run in this lane; storage/library identity work is owned by the parallel storage lane.
