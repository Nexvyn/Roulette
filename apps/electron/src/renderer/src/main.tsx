import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

try {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  console.error("Failed to render app", error);
  rootElement.innerHTML = `
    <div style="padding:24px;color:#f4f6f4;font-family:Segoe UI,sans-serif;background:#101215;min-height:100vh;">
      <h1 style="margin:0 0 12px;">Lyra failed to render</h1>
      <pre style="white-space:pre-wrap;line-height:1.5;">${String(error)}</pre>
    </div>
  `;
}
