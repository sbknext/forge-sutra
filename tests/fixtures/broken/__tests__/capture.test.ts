// Test file that imports from a module that does NOT exist → dangling_test_ref
import { describe, it } from "vitest";
import { submitCapture } from "./gone.js"; // gone.js does not exist in this fixture

describe("capture", () => {
  it("submits", async () => {
    await submitCapture({ event: "test" });
  });
});
