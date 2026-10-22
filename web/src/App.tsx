import { BrowserRouter, Route, Routes } from "react-router";
import { Shell } from "./components/Shell.tsx";
import type { AppConfig } from "./lib/config.ts";
import { Collection } from "./pages/Collection.tsx";
import { Home } from "./pages/Home.tsx";
import { Kat } from "./pages/Kat.tsx";
import { Launch } from "./pages/Launch.tsx";
import { Verify } from "./pages/Verify.tsx";
import { ContractScope, HomeScope } from "./scope.tsx";
import { ServicesProvider } from "./services.tsx";
import type { WalletBackend } from "./wallet/backend.ts";
import { WalletProvider } from "./wallet/WalletProvider.tsx";

function NotFound() {
  return (
    <Shell world="surface">
      <h1 className="pt-16 text-5xl">Nothing here</h1>
      <p className="mt-4 text-mist">This tunnel doesn't lead anywhere. Head back to the surface.</p>
    </Shell>
  );
}

export function App({ config, backend }: { config: AppConfig; backend: WalletBackend }) {
  return (
    <WalletProvider backend={backend}>
      <ServicesProvider config={config}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/kat/:id"
              element={
                <HomeScope>
                  <Kat />
                </HomeScope>
              }
            />
            <Route
              path="/kat/:id/verify"
              element={
                <HomeScope>
                  <Verify />
                </HomeScope>
              }
            />
            <Route path="/launch" element={<Launch />} />
            <Route path="/c/:contractId" element={<Collection />} />
            <Route
              path="/c/:contractId/kat/:id"
              element={
                <ContractScope>
                  <Kat />
                </ContractScope>
              }
            />
            <Route
              path="/c/:contractId/kat/:id/verify"
              element={
                <ContractScope>
                  <Verify />
                </ContractScope>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ServicesProvider>
    </WalletProvider>
  );
}
