import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import nock from "nock";
import { SheetsClient } from "../src/sheets/SheetsClient";
import { ApiError } from "../src/sheets/types";

const auth = { getAccessToken: () => Promise.resolve("test-token") };
const ENDPOINT = "https://sheets.googleapis.com";

beforeEach(() => nock.cleanAll());
afterEach(() => nock.cleanAll());

describe("SheetsClient.read", () => {
  it("reads a single cell range", async () => {
    nock(ENDPOINT)
      .get("/v4/spreadsheets/1ABC/values/Sheet1!B3")
      .matchHeader("authorization", "Bearer test-token")
      .reply(200, { range: "Sheet1!B3", values: [["42"]] });

    const c = new SheetsClient(auth);
    const r = await c.read("1ABC", { sheet: "Sheet1", range: "B3" });
    expect(r.values).toEqual([["42"]]);
  });

  it("encodes sheet names with spaces", async () => {
    nock(ENDPOINT)
      .get("/v4/spreadsheets/1ABC/values/" + encodeURIComponent("施策 集計!A1:B2"))
      .reply(200, { range: "施策 集計!A1:B2", values: [["a", "b"], ["c", "d"]] });
    const c = new SheetsClient(auth);
    const r = await c.read("1ABC", { sheet: "施策 集計", range: "A1:B2" });
    expect(r.values).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("reads named range (no `!` qualifier)", async () => {
    nock(ENDPOINT)
      .get("/v4/spreadsheets/1ABC/values/MonthlyKPI")
      .reply(200, { range: "Sheet1!A1:B2", values: [["x", "y"]] });
    const c = new SheetsClient(auth);
    const r = await c.read("1ABC", { sheet: "Sheet1", named: "MonthlyKPI" });
    expect(r.values).toEqual([["x", "y"]]);
  });

  it("reads whole sheet when no range/named", async () => {
    nock(ENDPOINT)
      .get("/v4/spreadsheets/1ABC/values/Sheet1")
      .reply(200, { range: "Sheet1", values: [["x"]] });
    const c = new SheetsClient(auth);
    const r = await c.read("1ABC", { sheet: "Sheet1" });
    expect(r.values).toEqual([["x"]]);
  });

  it("throws ApiError on 403", async () => {
    nock(ENDPOINT)
      .get("/v4/spreadsheets/1ABC/values/Sheet1!B3")
      .reply(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "denied" } });
    const c = new SheetsClient(auth);
    await expect(c.read("1ABC", { sheet: "Sheet1", range: "B3" }))
      .rejects.toBeInstanceOf(ApiError);
  });

  it("retries on 429 with backoff", async () => {
    nock(ENDPOINT)
      .get("/v4/spreadsheets/1ABC/values/Sheet1!B3").reply(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "rate" } })
      .get("/v4/spreadsheets/1ABC/values/Sheet1!B3").reply(200, { range: "Sheet1!B3", values: [["ok"]] });

    const c = new SheetsClient(auth, { initialBackoffMs: 10, maxRetries: 3 });
    const r = await c.read("1ABC", { sheet: "Sheet1", range: "B3" });
    expect(r.values).toEqual([["ok"]]);
  }, 3000);
});

describe("SheetsClient.batchRead", () => {
  it("calls batchGet and splits results", async () => {
    nock(ENDPOINT)
      .get("/v4/spreadsheets/1ABC/values:batchGet")
      .query({ ranges: ["Sheet1!B3", "Sheet1!C4"] })
      .reply(200, {
        valueRanges: [
          { range: "Sheet1!B3", values: [["42"]] },
          { range: "Sheet1!C4", values: [["hello"]] },
        ],
      });
    const c = new SheetsClient(auth);
    const r = await c.batchRead("1ABC", [
      { sheet: "Sheet1", range: "B3" },
      { sheet: "Sheet1", range: "C4" },
    ]);
    expect(r.map((x) => x.values)).toEqual([[["42"]], [["hello"]]]);
  });
});

describe("SheetsClient.write", () => {
  it("PUTs single value with valueInputOption=USER_ENTERED", async () => {
    nock(ENDPOINT)
      .put("/v4/spreadsheets/1ABC/values/Sheet1!B3", (body) => {
        expect(body).toMatchObject({ values: [[42]] });
        return true;
      })
      .query({ valueInputOption: "USER_ENTERED" })
      .reply(200, { updatedRange: "Sheet1!B3", updatedCells: 1 });
    const c = new SheetsClient(auth);
    const r = await c.write("1ABC", { sheet: "Sheet1", range: "B3" }, 42, "replace");
    expect(r).toEqual({ updatedRange: "Sheet1!B3", updatedCells: 1 });
  });

  it("PUTs 2D array value", async () => {
    nock(ENDPOINT)
      .put("/v4/spreadsheets/1ABC/values/" + encodeURIComponent("Sheet1!A1:B2"), (body) => {
        expect(body).toMatchObject({ values: [[1, 2], [3, 4]] });
        return true;
      })
      .query({ valueInputOption: "USER_ENTERED" })
      .reply(200, { updatedRange: "Sheet1!A1:B2", updatedCells: 4 });
    const c = new SheetsClient(auth);
    const r = await c.write("1ABC", { sheet: "Sheet1", range: "A1:B2" }, [[1, 2], [3, 4]], "replace");
    expect(r.updatedCells).toBe(4);
  });

  it("uses :append endpoint when mode=append", async () => {
    nock(ENDPOINT)
      .post("/v4/spreadsheets/1ABC/values/Sheet1!A1:append")
      .query({ valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" })
      .reply(200, { updates: { updatedRange: "Sheet1!A5", updatedCells: 1 } });
    const c = new SheetsClient(auth);
    const r = await c.write("1ABC", { sheet: "Sheet1", range: "A1" }, [["new"]], "append");
    expect(r).toEqual({ updatedRange: "Sheet1!A5", updatedCells: 1 });
  });
});
