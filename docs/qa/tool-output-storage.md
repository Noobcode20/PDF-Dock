> Historical lane checkpoint. The integrated implementation and final parent verification are recorded in [ISSUE_SWEEP.md](ISSUE_SWEEP.md) and [REAL_DOCUMENT_VERIFICATION.md](REAL_DOCUMENT_VERIFICATION.md).

# Tool output naming and destinations

Parent implementation for issues #7, #8, #9, #10, #17 after the delegated lane returned without changes.

- Generated results expose an editable filename and explicit destination after processing.
- PDFs support library only, device only, or both; other formats support device export.
- Name and destination choices live with the output draft and are honored by pending-save handling.
- Explicit library writes work independently of automatic recent-file preferences and keep a separate stored copy.
- Canceled exports leave results pending. Library failure after export reports the partial success and retains the result for retry.
- Main merge rows use neutral styling. File picker selection remains highlighted.
- Save uses the existing download icon. Existing centered add-file control and icon remain in place.

Validation: complete `npm test`, production build, and `git diff --check` passed. New focused tests exercise names, destinations, cancellation, partial failures and unsupported formats. Runtime result-panel review remains pending integration. Existing Vite large-chunk warnings remain.
