# PDF Dock issue sweep — 2026-11-04

## Objective and safeguards
Review the current app and all GitHub reports, fix verified defects, improve confusing workflows, and push reviewable, tested changes. Use GPT-6 Luna through provider `codex` (Codex, not Jovin). Do not publish installers or close issues without verification. Agents work in isolated checkouts; integration and final review happen centrally.

## Starting state
- Clean checkout at `cd8dbe1`; already pushed and merged into master through PR #15.
- Base: origin/master `99415c3`.
- Existing PR #11 is conflicting; its substantive fixes appear integrated in beta.6. Audit for remaining unique work before disposition.
- All 20 issue reports are open. Full report bodies are preserved in `github-issues-2026-11-04.json`.
- Baseline build and complete Node regression suite: passed. Build reports existing large-chunk warnings.

## Issue inventory
| Issue | Report | Status |
| --- | --- | --- |
| [#24](https://github.com/Noobcode20/PDF-Dock/issues/24) | Undo and Redo Issue | Pending investigation |
| [#23](https://github.com/Noobcode20/PDF-Dock/issues/23) | Ugly Side Panel | Pending investigation |
| [#22](https://github.com/Noobcode20/PDF-Dock/issues/22) | Image Processing Error | Pending investigation |
| [#21](https://github.com/Noobcode20/PDF-Dock/issues/21) | Logic Issue for Add PDF | Pending investigation |
| [#20](https://github.com/Noobcode20/PDF-Dock/issues/20) | Large Popup | Pending investigation |
| [#19](https://github.com/Noobcode20/PDF-Dock/issues/19) | Image is auto selecting | Pending investigation |
| [#18](https://github.com/Noobcode20/PDF-Dock/issues/18) | PDF Saving | Pending investigation |
| [#17](https://github.com/Noobcode20/PDF-Dock/issues/17) | PDF Storage | Pending investigation |
| [#16](https://github.com/Noobcode20/PDF-Dock/issues/16) | confetti | Pending investigation |
| [#14](https://github.com/Noobcode20/PDF-Dock/issues/14) | Item reposition Error | Pending investigation |
| [#13](https://github.com/Noobcode20/PDF-Dock/issues/13) | Text Unbolding Issue | Pending investigation |
| [#12](https://github.com/Noobcode20/PDF-Dock/issues/12) | Preview Issue | Pending investigation |
| [#10](https://github.com/Noobcode20/PDF-Dock/issues/10) | Icon issue | Pending investigation |
| [#9](https://github.com/Noobcode20/PDF-Dock/issues/9) | PDF Naming | Pending investigation |
| [#8](https://github.com/Noobcode20/PDF-Dock/issues/8) | Coloring error | Pending investigation |
| [#7](https://github.com/Noobcode20/PDF-Dock/issues/7) | Add file errors | Pending investigation |
| [#6](https://github.com/Noobcode20/PDF-Dock/issues/6) | Image Edit Doesn't work | Pending investigation |
| [#5](https://github.com/Noobcode20/PDF-Dock/issues/5) | Text Box Delete Not Working | Pending investigation |
| [#3](https://github.com/Noobcode20/PDF-Dock/issues/3) | Shortcut Customizability | Pending investigation |
| [#2](https://github.com/Noobcode20/PDF-Dock/issues/2) | Editing text in the app doesn't remove the text. | Pending investigation |

## Work lanes
1. Home import and deletion dialog (#20, #21).
2. Tool output naming, destination, merge controls (#7–10, #17).
3. Editor save to library versus export (#18).
4. Undo/redo (#24).
5. Image source removal, transforms, explicit selection (#6, #19, #22).
6. Image inspector usability and collapsible sections (#23).
7. Text deletion, mixed formatting, true removal (#2, #5, #13).
8. Shortcut customization and success feedback (#3, #16).
9. Responsive layout, scrolling, existing PR review (#12, #14, PR #11).

## Acceptance gates
- Reproduce or inspect the owning code before changing behavior.
- Targeted regression checks for data loss and editing defects.
- Full regression suite and production build after integration.
- Exercise save/reopen, undo/redo, imports, image transforms, and narrow layouts where supported.
- Record unverified platform behavior and PDF limitations explicitly.
- Push only coherent work, with issue-linked PR descriptions and validation evidence.

## Integration log
- Inventory recorded; nine isolated GPT-6 Luna lanes launched through Codex.
- Tool-output delegate returned without changes. Parent implemented editable names, explicit app/device/both destinations, neutral merge rows, and destination regression checks. Targeted tests and production build passed; runtime workflow review remains pending.

## Remaining work
All lanes, independent review, integrated verification, and push.
