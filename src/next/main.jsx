import React from "react";
import ReactDOM from "react-dom/client";
import NextApp from "./NextApp.jsx";
import "./next.css";

// Same persistence shim as src/main.jsx: the data layer reads `window.storage`. Both looks run on
// one address, so they share the browser's saved budgets, drivers, documents and plans.
if (!window.storage) {
  window.storage = {
    async get(k) {
      const v = localStorage.getItem(k);
      return v == null ? null : { value: v };
    },
    async set(k, v) {
      localStorage.setItem(k, v);
    },
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <NextApp />
  </React.StrictMode>
);
