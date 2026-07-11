/**
 * Browser entry: construct the engine (facade), mount the React app into #app.
 * The engine outlives the React mount — `<InfiniteCanvas>` never disposes it.
 */
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { App } from "./app";
import { createMoodboardEngine } from "./engine";

const appEl = document.getElementById("app");
if (appEl === null) throw new Error("moodboard: #app element not found");

const { engine } = createMoodboardEngine();
createRoot(appEl).render(createElement(App, { engine }));
