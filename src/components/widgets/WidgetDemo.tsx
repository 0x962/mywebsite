import { useState } from "react";

/**
 * Throwaway demo widget — proves a live, interactive React component renders
 * inside an Excalidraw embeddable (iframe). Delete once a real widget exists.
 */
export default function WidgetDemo() {
  const [n, setN] = useState(0);
  return (
    <button
      onClick={() => setN((v) => v + 1)}
      style={{
        font: "16px system-ui, sans-serif",
        padding: "16px 20px",
        borderRadius: 10,
        border: "2px solid #1e1e1e",
        background: "#ffd43b",
        cursor: "pointer",
      }}
    >
      live widget — clicked {n}×
    </button>
  );
}
