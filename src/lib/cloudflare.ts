import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface D1Statement {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): { bind(...values: unknown[]): D1Statement };
}

export function isCloudflareProduction(): boolean {
  return process.env.APP_ENV === "production";
}

export async function getD1(): Promise<D1Database | null> {
  if (!isCloudflareProduction()) return null;
  const context = await getCloudflareContext({ async: true });
  return ((context.env as Record<string, unknown>).DB as D1Database | undefined) ?? null;
}
