import React from "react";
export function FormCandidatesPanel({ candidates, onChange, onAccept }) {
  if (!candidates.length) return null;
  return (
    <div className="form-candidates">
      <strong>Suggested fields · review before accepting</strong>
      {candidates.map((candidate, index) => (
        <div key={index}>
          <input
            aria-label={`Field ${index + 1} name`}
            value={candidate.name}
            onChange={(e) => onChange(index, { name: e.target.value })}
          />
          <select
            aria-label={`Field ${index + 1} type`}
            value={candidate.kind}
            onChange={(e) => onChange(index, { kind: e.target.value })}
          >
            <option value="text">Text</option>
            <option value="checkbox">Checkbox</option>
            <option value="dropdown">Dropdown</option>
          </select>
          {["x", "y", "width", "height"].map((key) => (
            <label key={key}>
              {key}
              <input
                type="number"
                min="0"
                max="100"
                step=".5"
                value={Math.round(candidate[key] * 1000) / 10}
                onChange={(e) =>
                  onChange(index, { [key]: Number(e.target.value) / 100 })
                }
              />
            </label>
          ))}
          <button
            className="editor-open-button"
            onClick={() => onAccept(index)}
          >
            Accept
          </button>
          <button
            className="editor-open-button"
            onClick={() => onChange(index, null)}
          >
            Reject
          </button>
        </div>
      ))}
    </div>
  );
}
