export function assertSafeToSeed(env: NodeJS.ProcessEnv = process.env): void {
  const databaseUrl = env.DATABASE_URL ?? "";
  if (env.NODE_ENV === "production" || env.K_SERVICE || databaseUrl.includes("/cloudsql/")) {
    throw new Error("refusing to seed a production or Cloud Run database");
  }
}
