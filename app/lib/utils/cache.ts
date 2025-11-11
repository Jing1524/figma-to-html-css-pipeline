"use server";
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function writeJson(p: string, data: unknown) {
  await ensureDir(path.dirname(p));
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(p, json, "utf8");
}

export async function readJson<T>(p: string): Promise<T> {
  const buf = await fs.readFile(p, "utf8");
  return JSON.parse(buf) as T;
}

export async function writeText(p: string, text: string) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, text, "utf8");
}
