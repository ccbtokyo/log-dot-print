#!/usr/bin/env bun
/**
 * Cross-platform UI build script
 */
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";

const srcDir = "src/ui";
const outDir = "dist/ui";

async function main() {
  // 1. Build TypeScript
  const buildResult = await Bun.spawn(
    ["bun", "build", `${srcDir}/main.ts`, "--outdir", outDir, "--format=esm"],
    { stdio: ["inherit", "inherit", "inherit"] },
  ).exited;

  if (buildResult !== 0) {
    console.error("[build-ui] TypeScript build failed");
    process.exit(1);
  }

  // 2. Copy static files
  await mkdir(outDir, { recursive: true });

  const filesToCopy = [
    { src: join(srcDir, "index.html"), dest: join(outDir, "index.html") },
    { src: join(srcDir, "styles", "main.css"), dest: join(outDir, "main.css") },
  ];

  for (const { src, dest } of filesToCopy) {
    try {
      await copyFile(src, dest);
      console.log(`[build-ui] Copied ${src} -> ${dest}`);
    } catch (err) {
      // File may not exist, that's ok
      console.warn(`[build-ui] Skipped ${src} (not found)`);
    }
  }

  console.log("[build-ui] Done");
}

main().catch((err) => {
  console.error("[build-ui] Error:", err);
  process.exit(1);
});
