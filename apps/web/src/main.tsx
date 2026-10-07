import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App.js";
import "./styles.css";
import "./design-system.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root element #root was not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
