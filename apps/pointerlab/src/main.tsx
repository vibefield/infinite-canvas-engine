import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CursorLayer } from "./CursorLayer";

const root = document.getElementById("prototype-root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <CursorLayer />
    </StrictMode>,
  );
}
