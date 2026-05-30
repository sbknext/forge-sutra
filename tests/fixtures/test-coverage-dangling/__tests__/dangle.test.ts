import { missingTarget } from "../lib/gone.js";

test("dangling ref", () => {
  expect(missingTarget()).toBeDefined();
});
