import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./app.js";

describe("health", () => {
  it("reports API health", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });
});
