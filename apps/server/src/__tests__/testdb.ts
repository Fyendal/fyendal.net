import { DataType, newDb } from "pg-mem";
import { applyMigrations, MIGRATIONS, type Queryable } from "../db.js";

function preserveBinaryParameters(target: Queryable): Queryable {
  const wrapped: Queryable & { end?: () => Promise<void> } = {
    query: (text, params) => {
      let sql = text;
      const values = params?.map((value, index) => {
        if (!Buffer.isBuffer(value)) return value;
        const position = index + 1;
        sql = sql.replace(
          new RegExp(`\\$${position}(?!\\d)`, "g"),
          `decode($${position}, 'base64')`,
        );
        return value.toString("base64");
      });
      return target.query(sql, values);
    },
  };
  if (target.connect) {
    wrapped.connect = async () => preserveBinaryParameters(await target.connect!());
  }
  if (target.release) wrapped.release = () => target.release!();
  const pool = target as Queryable & { end?: () => Promise<void> };
  if (pool.end) wrapped.end = () => pool.end!();
  return wrapped;
}

/** Fresh isolated in-memory Postgres with all migrations applied. */
export async function freshDb(): Promise<Queryable> {
  const memory = newDb();
  // pg-mem's pg adapter coerces Buffer parameters through UTF-8. Its test-only
  // adapter below routes those parameters through PostgreSQL decode() while
  // production sends native Buffer values to node-postgres unchanged.
  memory.public.registerFunction({
    name: "decode",
    args: [DataType.text, DataType.text],
    returns: DataType.bytea,
    implementation: (value: string, encoding: string) => {
      if (encoding !== "base64") throw new Error("unsupported decode encoding");
      return Buffer.from(value, "base64");
    },
  });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  await applyMigrations(pool, MIGRATIONS);
  return preserveBinaryParameters(pool);
}
