import { describe, it, expect } from "vitest";
import { authenticate } from "../src/auth";

describe("authenticate", () => {
  it("returns true when Authorization header matches API_KEY", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer secret123" },
    });
    expect(authenticate(request, "secret123")).toBe(true);
  });

  it("returns false when header is missing", () => {
    const request = new Request("https://example.com");
    expect(authenticate(request, "secret123")).toBe(false);
  });

  it("returns false when token does not match", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer wrongtoken" },
    });
    expect(authenticate(request, "secret123")).toBe(false);
  });

  it("returns false when scheme is not Bearer", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Basic secret123" },
    });
    expect(authenticate(request, "secret123")).toBe(false);
  });
});
