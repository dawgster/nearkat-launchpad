import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { loadConfig } from "./lib/config.ts";
import { connectorBackend, devBackend } from "./wallet/backend.ts";

const root = createRoot(document.getElementById("root") as HTMLElement);
try {
  const config = loadConfig(import.meta.env);
  const backend = config.devWallet ? devBackend(config) : connectorBackend(config);
  root.render(
    <StrictMode>
      <App config={config} backend={backend} />
    </StrictMode>,
  );
} catch (error) {
  // A missing setting is the developer's to fix; say which one.
  root.render(<p style={{ padding: 24 }}>Can't start: {String(error)}</p>);
}
