import { requestInput } from "./requestInput";
import { normalizedPoint, regionFromPoints } from "./coordinates";
import React, { useRef, useState, useEffect } from "react";
const modes = [
  "draw",
  "rectangle",
  "ellipse",
  "line",
  "arrow",
  "comment",
  "form-text",
  "form-checkbox",
  "form-dropdown",
  "form-list",
  "form-radio",
];
export function AnnotationLayer({
  page,
  mode,
  items = [],
  style = {},
  onAdd,
  rotation = 0,
  pageNode,
}) {
  const drag = useRef(null),
    [preview, setPreview] = useState(null);
  const point = (event) => {
    const b = event.currentTarget.getBoundingClientRect();
    return normalizedPoint(b, event.clientX, event.clientY);
  };
  useEffect(() => {
    if (!["highlight", "underline", "strike"].includes(mode)) return;
    const node = pageNode.current;
    const select = () => {
      const selection = window.getSelection();
      if (
        !selection?.rangeCount ||
        !selection.toString() ||
        !node.contains(selection.anchorNode) ||
        !node.contains(selection.focusNode)
      )
        return;
      const b = node.getBoundingClientRect();
      const rects = [...selection.getRangeAt(0).getClientRects()].filter(
        (r) => r.width > 1 && r.height > 1,
      );
      const annotations = rects.map((r) => ({
        type: "annotation",
        kind: mode,
        page,
        viewerRotation: rotation,
        ...style,
        x: (r.left - b.left) / b.width,
        y: (r.top - b.top) / b.height,
        width: r.width / b.width,
        height: r.height / b.height,
      }));
      onAdd(annotations);
      selection.removeAllRanges();
    };
    node?.addEventListener("pointerup", select);
    return () => node?.removeEventListener("pointerup", select);
  }, [mode, page, rotation, style, onAdd, pageNode]);
  const end = async (event) => {
    if (!drag.current) return;
    const start = drag.current[0],
      end = point(event),
      points = mode === "draw" ? [...drag.current, end] : [start, end];
    let item = {
      type: "annotation",
      kind: mode,
      page,
      viewerRotation: rotation,
      ...style,
      points,
      x: Math.min(start[0], end[0]),
      y: Math.min(start[1], end[1]),
      width: Math.max(0.018, Math.abs(end[0] - start[0])),
      height: Math.max(0.018, Math.abs(end[1] - start[1])),
    };
    drag.current = null;
    setPreview(null);
    if (mode === "comment") {
      const text = await requestInput("Comment");
      if (text === null) return;
      item = { ...item, text, width: 0.035, height: 0.035 };
    }
    if (mode.startsWith("form-")) {
      const name = await requestInput(
        "Unique field name",
        `field_${Date.now()}`,
      );
      if (!name) return;
      item = { ...item, type: "form-create", kind: mode.slice(5), name };
    }
    onAdd([{...item, key: crypto.randomUUID()}]);
  };
  return (
    <svg
      className={`editor-annotation-layer ${modes.includes(mode) ? "is-active" : ""}`}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      onPointerDown={(event) => {
        if (!modes.includes(mode)) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = [point(event)];
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const p = point(event);
        if (mode === "draw") drag.current.push(p);
        setPreview({
          kind: mode,
          points: [...drag.current, p],
          x: Math.min(drag.current[0][0], p[0]),
          y: Math.min(drag.current[0][1], p[1]),
          width: Math.abs(p[0] - drag.current[0][0]),
          height: Math.abs(p[1] - drag.current[0][1]),
          ...style,
        });
      }}
      onPointerUp={end}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
    >
      {[...items, ...(preview ? [preview] : [])].map((item, index) => {
        const c = item.color || "#ffcc00",
          x = item.x * 1000,
          y = item.y * 1000,
          w = item.width * 1000,
          h = item.height * 1000,
          props = {
            stroke: c,
            strokeWidth: (item.thickness || 2) * ((pageNode.current?.clientWidth || 816) / (Number(style.pageWidth) || 612)),
            opacity: item.opacity ?? 0.5,
            fill: "none",
            vectorEffect: "non-scaling-stroke",
          };
        return ["draw", "line", "arrow"].includes(item.kind) && item.points ? (
          <g key={index}>
            <polyline points={item.points.map(p=>p.map(n=>n*1000).join(',')).join(' ')} {...props}/>
            {item.kind==='arrow'&&item.points.length>1&&[-.5,.5].map(delta=>{
              const end=item.points.at(-1),start=item.points.at(-2),bounds=pageNode.current?.getBoundingClientRect();
              const width=bounds?.width||612,height=bounds?.height||792;
              const angle=Math.atan2((end[1]-start[1])*height,(end[0]-start[0])*width);
              const length=12*width/(Number(style.pageWidth)||612);
              return <line key={delta} x1={end[0]*1000} y1={end[1]*1000}
                x2={(end[0]-length*Math.cos(angle+delta)/width)*1000}
                y2={(end[1]-length*Math.sin(angle+delta)/height)*1000} {...props}/>;
            })}
          </g>
        ) : item.kind === "ellipse" ? (
          <ellipse
            key={index}
            cx={x + w / 2}
            cy={y + h / 2}
            rx={w / 2}
            ry={h / 2}
            {...props}
          />
        ) : ["underline", "strike"].includes(item.kind) ? (
          <line
            key={index}
            x1={x}
            x2={x + w}
            y1={y + (item.kind === "strike" ? h / 2 : h)}
            y2={y + (item.kind === "strike" ? h / 2 : h)}
            {...props}
          />
        ) : (
          <rect
            key={index}
            x={x}
            y={y}
            width={w}
            height={h}
            {...props}
            fill={["highlight", "comment"].includes(item.kind) ? c : "none"}
          />
        );
      })}
    </svg>
  );
}
