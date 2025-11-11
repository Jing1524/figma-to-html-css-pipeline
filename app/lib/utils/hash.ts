"use server";
import "server-only";
import crypto from "node:crypto";

export function createHashId(input: string | object): string {
  const str = typeof input === "string" ? input : JSON.stringify(input);
  return crypto.createHash("sha1").update(str).digest("hex").slice(0, 12);
}
