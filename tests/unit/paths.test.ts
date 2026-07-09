import { describe, it, expect } from "vitest";
import { normalizePath } from "../../src/util/paths.js";

describe("normalizePath", () => {
  it("strips leading slash from file:///c:/ Windows URIs", () => {
    expect(normalizePath("/c:/source/traceback")).toBe(normalizePath("c:\\source\\traceback"));
  });

  it("lowercases and normalizes separators", () => {
    expect(normalizePath("C:\\Source\\Repo")).toBe("c:/source/repo");
  });
});
