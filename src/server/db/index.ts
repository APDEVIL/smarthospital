import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { env } from "@/env";
import * as schema from "./schema";

// Required in Node.js runtimes (edge/browser runtimes have native
// WebSocket and don't need this — but setting it unconditionally is safe).
neonConfig.webSocketConstructor = ws;

/**
 * Cache the connection pool across HMR reloads in development.
 * Without this, every file-save during `next dev` creates a brand new
 * Pool, and you eventually exhaust Neon's connection limit.
 */
const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

const pool =
  globalForDb.pool ?? new Pool({ connectionString: env.DATABASE_URL });
if (env.NODE_ENV !== "production") globalForDb.pool = pool;

// Explicit NeonDatabase<typeof schema> annotation pins `db` to the Neon
// serverless (WebSocket/Pool) Postgres driver — NOT MySQL. This is the
// fix for the original bug: db/index.ts was importing
// `drizzle-orm/mysql2`, while schema.ts is built entirely with
// `drizzle-orm/pg-core` (pgTable, pgEnum, uuid). That mismatch is why
// every router call against a pg table failed against MySqlTable's type
// shape, and why `.returning()` "didn't exist" — MySQL has no RETURNING.
//
// This driver also supports db.transaction(), which neon-http does not.
export const db: NeonDatabase<typeof schema> = drizzle(pool, { schema });

export type DB = typeof db;