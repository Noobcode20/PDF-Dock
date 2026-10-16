import React, { useEffect, useState } from "react";
export function PasswordDialog() {
  const [request, setRequest] = useState(null),
    [password, setPassword] = useState("");
  useEffect(() => {
    const ask = (event) => {
      setPassword(event.detail.value || "");
      setRequest(event.detail);
    };
    window.addEventListener("pdfking-password", ask);
    window.addEventListener("pdfking-input", ask);
    return () => {
      window.removeEventListener("pdfking-password", ask);
      window.removeEventListener("pdfking-input", ask);
    };
  }, []);
  if (!request) return null;
  const answer = (value) => {
    request.resolve(value);
    setRequest(null);
    setPassword("");
  };
  return (
    <div className="confirm-backdrop">
      <form
        className="confirm-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            answer(null);
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          answer(password);
        }}
      >
        <h2 id="password-title">
          {request.title ||
            (request.incorrect
              ? "Incorrect password. Try again."
              : "Enter PDF password")}
        </h2>
        <label>
          {request.title ? "Text" : "Password"}
          <input
            className="studio-input"
            autoFocus
            type={request.title ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="confirm-actions">
          <button
            className="confirm-btn"
            type="button"
            onClick={() => answer(null)}
          >
            Cancel
          </button>
          <button className="confirm-btn confirm-btn-primary" type="submit">
            {request.title ? "Continue" : "Open PDF"}
          </button>
        </div>
      </form>
    </div>
  );
}
