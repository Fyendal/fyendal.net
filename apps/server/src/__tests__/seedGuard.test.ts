import { describe, expect, it } from "vitest";
import { assertSafeToSeed } from "../seedGuard.js";

describe("production seed guard", () => {
  it("allows local development only", () => {
    expect(() => assertSafeToSeed({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertSafeToSeed({ NODE_ENV: "production" })).toThrow(/refusing to seed/);
    expect(() => assertSafeToSeed({ K_SERVICE: "fyendal" })).toThrow(/refusing to seed/);
    expect(() => assertSafeToSeed({ DATABASE_URL: "postgres://u:p@/db?host=/cloudsql/project:region:db" })).toThrow(/refusing to seed/);
  });
});
