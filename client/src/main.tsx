import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { PreviewScreen } from "./PreviewScreen.js";
import "./styles.css";

const isPreview = new URLSearchParams(window.location.search).has("preview");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isPreview ? <PreviewScreen /> : <App />}
  </React.StrictMode>,
);
