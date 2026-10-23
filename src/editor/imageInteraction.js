/** Interaction rules for the placed images in the editor.
 *
 * They live outside the component so the rules can be read, and tested,
 * without a browser: the component only has to follow them. */

/** What a double click on a placed image does.
 *
 * A double click opens the image inspector for the image. It never moves,
 * duplicates or transforms the image, and it never reads the artwork again
 * when the image already carries its source (or a read is already running).
 *
 * @param {{sourceLoaded?: boolean, capturePending?: boolean}} state
 */
export function imageDoubleClickPlan({ sourceLoaded = false, capturePending = false } = {}) {
  return {
    /* The image becomes the selected object. */
    select: true,
    /* The image inspector is opened for it. */
    openInspector: true,
    /* The pointer gesture that came with the double click is dropped, so no
     * drag is committed when the pointer is released. */
    cancelGesture: true,
    /* A stale drag preview is dropped with it. */
    clearPreview: true,
    /* The artwork is only read when it is missing and no read is running. */
    captureSource: !sourceLoaded && !capturePending,
  };
}
