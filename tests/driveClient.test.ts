import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { DriveClient } from "../src/sheets/DriveClient";

const auth = { getAccessToken: () => Promise.resolve("test-token") };

beforeEach(() => nock.cleanAll());
afterEach(() => nock.cleanAll());

describe("DriveClient.getModifiedTime", () => {
  it("returns modifiedTime", async () => {
    nock("https://www.googleapis.com")
      .get("/drive/v3/files/1ABC")
      .query({ fields: "modifiedTime" })
      .reply(200, { modifiedTime: "2026-05-30T13:00:00.000Z" });
    const c = new DriveClient(auth);
    const t = await c.getModifiedTime("1ABC");
    expect(t).toBe("2026-05-30T13:00:00.000Z");
  });

  it("throws on 404", async () => {
    nock("https://www.googleapis.com")
      .get("/drive/v3/files/missing")
      .query({ fields: "modifiedTime" })
      .reply(404, { error: { code: 404, status: "NOT_FOUND", message: "not found" } });
    const c = new DriveClient(auth);
    await expect(c.getModifiedTime("missing")).rejects.toThrow();
  });
});
