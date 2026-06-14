import { useState, useRef, useCallback, type ReactNode } from "react";

interface Props {
  direction: "horizontal" | "vertical";
  sizes: [number, number];
  children: [ReactNode, ReactNode];
  minSize?: number;
}

export function SplitPane({ direction, sizes, children, minSize = 100 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(sizes[0] / (sizes[0] + sizes[1]));
  const dragging = useRef(false);

  const isHorizontal = direction === "horizontal";

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const onMouseMove = (e: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const total = isHorizontal ? rect.width : rect.height;
        const pos = isHorizontal ? e.clientX - rect.left : e.clientY - rect.top;
        const newRatio = Math.max(
          minSize / total,
          Math.min(1 - minSize / total, pos / total)
        );
        setRatio(newRatio);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [isHorizontal, minSize]
  );

  const first = `${ratio * 100}%`;
  const second = `${(1 - ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: isHorizontal ? "row" : "column",
        height: "100%",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <div style={{ [isHorizontal ? "width" : "height"]: first, overflow: "hidden" }}>
        {children[0]}
      </div>
      <div
        onMouseDown={onMouseDown}
        style={{
          [isHorizontal ? "width" : "height"]: 4,
          backgroundColor: "#2a2a4a",
          cursor: isHorizontal ? "col-resize" : "row-resize",
          flexShrink: 0,
        }}
      />
      <div style={{ [isHorizontal ? "width" : "height"]: second, overflow: "hidden" }}>
        {children[1]}
      </div>
    </div>
  );
}
