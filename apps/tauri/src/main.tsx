import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const ua = navigator.userAgent;
document.documentElement.dataset.platform = /Mac/i.test(ua) ? "mac" : /Win/i.test(ua) ? "win" : "linux";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
