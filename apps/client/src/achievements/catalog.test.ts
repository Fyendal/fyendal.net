import { expect, it } from "vitest";
import { ACTIVE_ACHIEVEMENT_IDS } from "@fyendal/protocol";
import { ACHIEVEMENT_GROUPS } from "./catalog.js";

it("lists every active achievement and hides retired Starvo", () => {
  const listed = ACHIEVEMENT_GROUPS.flatMap((group) => group.ids);
  expect(listed).toEqual(ACTIVE_ACHIEVEMENT_IDS);
  expect(listed).not.toContain("beat-starvo");
  expect(listed).toContain("beat-levia");
});
