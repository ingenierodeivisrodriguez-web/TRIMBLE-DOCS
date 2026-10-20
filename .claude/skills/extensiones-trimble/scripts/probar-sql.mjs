// Checks that a Supabase SQL file of this repository runs on a fresh Postgres
// and can be run again without errors (the scripts must be re-runnable).
// Uses PGlite (Postgres in memory). Node finds the package next to the script,
// so copy this file into a scratch folder that has it installed:
//
//   cd <scratch>/pg && npm init -y && npm i @electric-sql/pglite
//   cp <skill>/scripts/probar-sql.mjs <scratch>/pg/
//   node <scratch>/pg/probar-sql.mjs <repo>/supabase/presupuesto.sql
//
// Add below the queries that exercise new functions (select public.mi_funcion(...)).
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("Uso: node probar-sql.mjs <archivo.sql>");
  process.exit(1);
}
const db = new PGlite();
// Supabase roles the scripts grant to.
await db.exec("create role service_role; create role anon; create role authenticated;");
const sql = fs.readFileSync(sqlPath, "utf8");
await db.exec(sql);
await db.exec(sql);
console.log(`ok: ${sqlPath} se ejecutó dos veces sin errores`);

// Example check (edit for the change being tested):
// const r = await db.query("select count(*)::int as n from public.presupuesto_lineas_base");
// console.log(r.rows);
