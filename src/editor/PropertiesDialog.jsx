import React, { useState, useEffect } from "react";
export function PropertiesDialog({ file, onClose, onCommit }) {
  const [values, setValues] = useState({
      title: "",
      author: "",
      subject: "",
      keywords: "",
      creator: "",
    }),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    import("pdf-lib")
      .then(async ({ PDFDocument }) => {
        const pdf = await PDFDocument.load(await file.arrayBuffer(), {
          updateMetadata: false,
        });
        if (active)
          setValues({
            title: pdf.getTitle() || "",
            author: pdf.getAuthor() || "",
            subject: pdf.getSubject() || "",
            keywords: pdf.getKeywords() || "",
            creator: pdf.getCreator() || "",
          });
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [file]);
  return (
    <div className="confirm-backdrop">
      <form
        className="confirm-panel"
        role="dialog"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onCommit([{ type: "metadata", values }]);
            onClose();
          } catch (cause) {
            setError(cause.message);
          }
        }}
      >
        <h2>Document properties</h2>
        {Object.entries(values).map(([key, value]) => (
          <label className="tool-field" key={key}>
            {key}
            <input
              className="studio-input"
              value={value}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </label>
        ))}
        {error && <p role="alert">{error}</p>}
        <div className="confirm-actions">
          <button className="confirm-btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="confirm-btn confirm-btn-primary">Apply</button>
        </div>
      </form>
    </div>
  );
}
