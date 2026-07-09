import { describe, expect, it } from "vitest";
import { KERNEL_VERSION } from "../src/index";

describe("kernel", () => {
  it("builds and exports", () => {
    expect(KERNEL_VERSION).toBe("0.0.0");
  });
});
