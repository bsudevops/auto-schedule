import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");

// Reuse one pool across hot reloads in development.
const g = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };

/**
 * Connection pools like Supabase's transaction pooler (port 6543) or PgBouncer can't keep prepared
 * statements, so they are switched off there. On Vercel each instance keeps only a few connections,
 * because many instances run at once and the database allows a limited number.
 */
const pooled = process.env.DATABASE_POOLED ? process.env.DATABASE_POOLED === "true" : /:6543(\/|\?|$)|pgbouncer=true/.test(url);
const max = Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 3 : 10);
const client = g.__pg ?? postgres(url, { max, prepare: !pooled, idle_timeout: process.env.VERCEL ? 20 : undefined, connect_timeout: 15 });
if (process.env.NODE_ENV !== "production") g.__pg = client;

export const db = drizzle(client, { schema });
export { schema };
