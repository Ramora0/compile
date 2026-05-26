import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { PreviewScreen } from "./PreviewScreen.js";
import { AnimationTester } from "./AnimationTester.js";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const screen = params.has("anim")
  ? "anim"
  : params.has("preview")
    ? "preview"
    : "app";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {screen === "anim" ? <AnimationTester /> : screen === "preview" ? <PreviewScreen /> : <App />}
  </React.StrictMode>,
);
