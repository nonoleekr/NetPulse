import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./app.js";

describe("health", () => {
  it("reports API health", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });

  describe("history validation", () => {
    it("rejects unbounded history windows before querying the database", async () => {
      const response = await request(app).get("/api/monitors/monitor-1/history?hours=721");
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
