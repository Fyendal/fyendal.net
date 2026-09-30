export function assertSafeToSeed(env: NodeJS.ProcessEnv = process.env): void {
  const databaseUrl = env.DATABASE_URL ?? "postgres://fyendal:fyendal@localhost:5432/fyendal";
  if (env.NODE_ENV === "production" || env.K_SERVICE || databaseUrl.includes("/cloudsql/")) {
    throw new Error("refusing to seed a production or remote database");
  }
  let hostname: string;
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("invalid protocol");
    if (url.searchParams.has("host")) throw new Error("host override");
    hostname = url.hostname;
  } catch {
    throw new Error("refusing to seed an invalid database URL");
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("refusing to seed a production or remote database");
  }
}
