import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

requestAnimationFrame(() => {
  const favicon = document.getElementById("favicon") as HTMLLinkElement | null;
  if (favicon) favicon.href = "/favicon.svg";
});
