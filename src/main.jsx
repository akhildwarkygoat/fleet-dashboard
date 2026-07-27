import React from "react";
import ReactDOM from "react-dom/client";
import App from "./Dashboard.jsx";
import "./index.css";

// Persistence shim: the dashboard's Store looks for `window.storage`
// (get -> { value }, set(key, stringValue)). Back it with localStorage so
// data survives page reloads when hosted locally.
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
    <App />
  </React.StrictMode>
);
