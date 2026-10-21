import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { loadConfig } from "./lib/config.ts";
import { connectorBackend, devBackend } from "./wallet/backend.ts";

const root = createRoot(document.getElementById("root") as HTMLElement);
try {
  // Each setting is read by name. Passing `import.meta.env` whole would copy
  // every VITE_ variable, including a dev wallet key, into the bundle.
  const config = loadConfig(
    {
      VITE_NEAR_NETWORK: import.meta.env.VITE_NEAR_NETWORK,
      VITE_NEAR_RPC_URL: import.meta.env.VITE_NEAR_RPC_URL,
      VITE_CONTRACT_ID: import.meta.env.VITE_CONTRACT_ID,
      VITE_KEEPER_URL: import.meta.env.VITE_KEEPER_URL,
      VITE_AUTH_RECIPIENT: import.meta.env.VITE_AUTH_RECIPIENT,
      VITE_FACTORY_ID: import.meta.env.VITE_FACTORY_ID,
      ...(import.meta.env.DEV
        ? {
            VITE_DEV_WALLET_ID: import.meta.env.VITE_DEV_WALLET_ID,
            VITE_DEV_WALLET_KEY: import.meta.env.VITE_DEV_WALLET_KEY,
          }
        : {}),
    },
    { production: import.meta.env.PROD },
  );
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
