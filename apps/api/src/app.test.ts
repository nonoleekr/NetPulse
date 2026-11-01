import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./app.js";

describe("health", () => {
  it("reports API health", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  describe("history validation", () => {
    it("rejects unbounded history windows before querying the database", async () => {
      const response = await request(app).get("/api/monitors/monitor-1/history?hours=721");
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns a structured not-found error", async () => {
      const response = await request(app).get("/api/does-not-exist");
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.headers["x-request-id"]).toBeTruthy();
    });

    it("rejects diagnostic requests with an unknown kind", async () => {
      const response = await request(app)
        .post("/api/monitors/monitor-1/diagnostics")
        .send({ kind: "PORT_SCAN" });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
