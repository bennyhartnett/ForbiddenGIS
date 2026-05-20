import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function githubPagesBase(): string {
  if (!process.env.CI) {
    return "/";
  }

  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const repoName = repository.split("/").filter(Boolean).pop() ?? "";

  if (!repoName || repoName.endsWith(".github.io")) {
    return "/";
  }

  return `/${repoName}/`;
}

export default defineConfig({
  base: githubPagesBase(),
  plugins: [react()],
});
