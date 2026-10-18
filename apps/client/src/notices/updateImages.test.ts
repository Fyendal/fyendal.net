import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeVersionUpdateImageSource } from "@fyendal/protocol";
import { describe, expect, it } from "vitest";

const publicDirectory = fileURLToPath(new URL("../../public/", import.meta.url));
const updatesDirectory = join(publicDirectory, "updates");
const MAX_UPDATE_IMAGE_BYTES = 500 * 1024;

function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    // Finder metadata such as .DS_Store is never referenced or published.
    if (entry.name.startsWith(".")) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

describe("version update images", () => {
  it("are referenceable notice images within the size budget", () => {
    const invalid = files(updatesDirectory).flatMap((path) => {
      const src = `/${relative(publicDirectory, path).split(sep).join("/")}`;
      return decodeVersionUpdateImageSource(src) && statSync(path).size <= MAX_UPDATE_IMAGE_BYTES ? [] : [src];
    });
    expect(invalid).toEqual([]);
  });
});
