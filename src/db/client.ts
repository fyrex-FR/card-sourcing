import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.js";

/** Type commun à node-postgres (prod) et PGlite (tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Dossier des migrations SQL, à deux niveaux de ce fichier (src/db ou dist/db). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function connectDatabase(url: string): Promise<{ db: Database; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  pool.on("error", (error) => console.error("[db] erreur de connexion inactive:", error.message));
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => pool.end() };
}
