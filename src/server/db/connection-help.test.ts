import { describe, expect, it } from "vitest";
import { explainDbConnectionError } from "./connection-help";

describe("explainDbConnectionError", () => {
  it("explains Supabase's IPv6-only direct host", () => {
    const msg = explainDbConnectionError(
      { code: "ENOTFOUND", hostname: "db.rmfrdhqkhtorqfhkxood.supabase.co" },
      "postgresql://postgres:secret@db.rmfrdhqkhtorqfhkxood.supabase.co:5432/postgres",
    );
    expect(msg).toMatch(/IPv6-only/);
    expect(msg).toMatch(/Session pooler/);
    expect(msg).not.toMatch(/secret/);
  });
  it("covers refused connections, bad passwords and certificates", () => {
    expect(explainDbConnectionError({ code: "ECONNREFUSED" }, "postgres://u:p@localhost:5432/x")).toMatch(/Is PostgreSQL running/);
    expect(explainDbConnectionError({ code: "28P01" }, undefined)).toMatch(/password/);
    expect(explainDbConnectionError({ message: "self-signed certificate in certificate chain" }, undefined)).toMatch(/uselibpqcompat/);
    expect(explainDbConnectionError({ code: "XX000", message: "boom" }, undefined)).toBeNull();
  });
});
