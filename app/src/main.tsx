import React from "react";
import ReactDOM from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import App from "./App";
import { installKit } from "@recursiveui/sdk";
import "./theme.css"; // CSS-var overrides to match the RecursiveUI dark look
import "./App.css";

installKit();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Theme appearance="dark" accentColor="jade" grayColor="sage" panelBackground="solid" radius="small" scaling="95%">
      <App />
    </Theme>
  </React.StrictMode>,
);
