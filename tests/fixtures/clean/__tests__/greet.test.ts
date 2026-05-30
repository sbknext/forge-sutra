// Test file that imports from an existing module → no dangling_test_ref.
import { describe, it, expect } from "vitest";
import { buildGreeting } from "../lib/greeter.js"; // exists on disk

describe("greeter", () => {
  it("formats greeting", () => {
    expect(buildGreeting("Alice")).toBe("Hello, Alice!");
  });
});
