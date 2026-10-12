import React, { useRef, useState, useEffect } from "react";

export function SignaturePanel({ onPlace, reusableSignature, setReusableSignature, targetLabel }) {
  const mounted = useRef(true);
  useEffect(() => {mounted.current=true;return () => {mounted.current=false}}, []);
  const canvas = useRef(null),
    drawing = useRef(false),
    [name, setName] = useState(""),
    [hasInk, setHasInk] = useState(false),
    [error, setError] = useState('');
  const placeCanvas = async () => {
    const blob = await new Promise((resolve) =>
      canvas.current.toBlob(resolve, "image/png"),
    );
    if (!blob) return;
    const signature = {
      data: new Uint8Array(await blob.arrayBuffer()),
      type: "image/png",
      aspect: 110 / 400,
    };
    if (!mounted.current) return;
    setReusableSignature(signature);
    onPlace(signature);
  };
  const point = (event) => {
    const b = canvas.current.getBoundingClientRect();
    return [
      ((event.clientX - b.left) * canvas.current.width) / b.width,
      ((event.clientY - b.top) * canvas.current.height) / b.height,
    ];
  };
  return (
    <div className="signature-editor">
      {targetLabel && <div className="option-note">Placing in signature field: <strong>{targetLabel}</strong></div>}
      <label>
        Type signature{" "}
        <input
          className="studio-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        className="editor-open-button"
        disabled={!name}
        onClick={() => onPlace({ text: name })}
      >
        Place typed signature
      </button>
      <canvas
        ref={canvas}
        width="400"
        height="110"
        aria-label="Draw signature"
        onPointerDown={(event) => {
          drawing.current = true;
          canvas.current.setPointerCapture(event.pointerId);
          const ctx = canvas.current.getContext("2d");
          ctx.strokeStyle = "#172231";
          ctx.lineWidth = 2;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(...point(event));
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = canvas.current.getContext("2d");
          ctx.lineTo(...point(event));
          ctx.stroke();
          setHasInk(true);
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <button
        className="editor-open-button"
        onClick={() => {canvas.current.getContext("2d").clearRect(0, 0, 400, 110);setHasInk(false)}}
      >
        Clear
      </button>
      <button className="editor-open-button" disabled={!hasInk} onClick={() => void placeCanvas()}>
        Place drawn signature
      </button>
      <label>
        Upload signature
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) { try {
              const data = new Uint8Array(await file.arrayBuffer());
              const bitmap = await createImageBitmap(file);
              const aspect = bitmap.height / bitmap.width;bitmap.close();
              const signature = {data, type: file.type, aspect};
              if (!mounted.current) return;
              setReusableSignature(signature);
              onPlace(signature);
            } catch {if(mounted.current)setError('This signature image could not be decoded.')} }
          }}
        />
      </label>
      {reusableSignature && (
        <button
          className="editor-open-button"
          onClick={() => onPlace(reusableSignature)}
        >
          Reuse signature
        </button>
      )}
      {error&&<span role="alert">{error}</span>}
      <span>Visual signature{targetLabel ? ` · field “${targetLabel}”` : ''}</span>
    </div>
  );
}
