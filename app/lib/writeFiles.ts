"use server";
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

export async function writeFiles(params: {
  fileKey: string;
  html: string;
  css: string;
}) {
  const base = path.join(process.cwd(), "public", "generated", params.fileKey);
  await fs.mkdir(base, { recursive: true });

  await fs.writeFile(path.join(base, "index.html"), params.html, "utf8");
  await fs.writeFile(path.join(base, "styles.css"), params.css, "utf8");

  return { outDir: base, assetsDir: path.join(base, "assets") };
}
