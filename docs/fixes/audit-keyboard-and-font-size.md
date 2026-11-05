# Keyboard repairs and custom font sizes

Home preview shortcuts now use the current selected record and only intercept Tab on the row itself, preserving traversal from nested action buttons. Custom selects and modal focus loops use tabbable controls, excluding hidden, inert and disabled elements.

Finding 32: the typography inspector and floating ribbon accept numeric sizes from 2 to 144 points, including fractions, with native preset suggestions. Empty and invalid values restore the last valid size on blur. Enter completes the size entry without committing the text session.

Validation against the local production build:

- `node scripts/test-audit-tab-traversal.cjs`: passed in isolated Electron; Home preview, row actions, modal wrapping and traversal; no renderer errors.
- `node scripts/test-audit-font-size.cjs`: passed in isolated Electron; 13 and 22.5 point synchronization, invalid/blank rollback and successful text commit; no renderer errors.
- `node scripts/test-audit-select-focus.cjs`: passed in isolated Electron, including disabled/hidden/inert controls, nested dialogs, viewport positioning and active text preservation. The Escape assertion waits for the scheduled focus restoration.
- `npm run build` and `git diff --check`: passed.

These checks do not establish packaged application behavior or PDF export font-size accuracy. Independent Jovin review remains pending; its issue 6 review failed because of the account usage limit.
