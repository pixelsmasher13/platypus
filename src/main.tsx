import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChakraProvider } from "@chakra-ui/react";
import { extendTheme, type ThemeConfig } from "@chakra-ui/react";
import { attachConsole } from "tauri-plugin-log-api";
import { appWindow } from "@tauri-apps/api/window";
import "@platypus-app/design/index.css";
import { App } from "./App";
import { MeetingPopup } from "./components/MeetingPopup";
import { theme } from "./theme";
import { SettingsProvider } from "./Providers/SettingsProvider";

const queryClient = new QueryClient();
const chakraTheme: ThemeConfig = extendTheme(theme);

attachConsole();

// Tauri opens the meeting-detected popup in a separate borderless window
// labeled "meeting-popup" (see meeting_popup.rs). We detect that via the
// window label rather than a URL hash, since Tauri's `WindowUrl::App`
// path-to-URL conversion can URL-encode `#` to `%23` and lose the
// fragment. The label is set in Rust and exposed synchronously by the
// Tauri JS API.
const isPopupWindow = appWindow.label === "meeting-popup";
const rootElement = document.getElementById("root") as HTMLElement;

if (isPopupWindow) {
  // The transparent Tauri window only shows through if html/body/root are
  // also transparent. The global design CSS sets backgrounds on these,
  // so override after import.
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.body.style.margin = "0";
  rootElement.style.background = "transparent";

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <MeetingPopup />
    </React.StrictMode>
  );
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <ChakraProvider theme={chakraTheme}>
            <SettingsProvider>
              <App />
            </SettingsProvider>
          </ChakraProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
}
