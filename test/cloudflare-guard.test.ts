import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { ipInRanges, validSignature } from "../cloudflare/guard.js";

const secret = "s3cret";
const payload = '{"action":"opened"}';
const bytes = new TextEncoder().encode(payload).buffer;
const sign = (key: string, text: string) => "sha256=" + createHmac("sha256", key).update(text).digest("hex");

describe("validSignature", () => {
  test("accepts the HMAC GitHub sends", async () => {
    expect(await validSignature(secret, bytes, sign(secret, payload))).toBe(true);
  });

  test.each([
    ["a different secret", sign("other", payload)],
    ["a different body", sign(secret, payload + " ")],
    ["no header", null],
    ["no sha256= prefix", sign(secret, payload).slice(7)],
    ["a short digest", "sha256=abcd"],
    ["non-hex", "sha256=" + "z".repeat(64)],
  ])("rejects %s", async (_name, header) => {
    expect(await validSignature(secret, bytes, header)).toBe(false);
  });
});

describe("ipInRanges", () => {
  const ranges = ["192.30.252.0/22", "140.82.112.0/20", "2a0a:a440::/29", "185.199.108.153/32"];

  test.each(["192.30.255.255", "140.82.127.1", "185.199.108.153", "2a0a:a440:1::5"])("allows %s", (ip) => {
    expect(ipInRanges(ip, ranges)).toBe(true);
  });

  test.each(["192.30.256.1", "8.8.8.8", "140.82.128.0", "185.199.108.154", "2606:4700::1", "not-an-ip", ""])(
    "rejects %s",
    (ip) => {
      expect(ipInRanges(ip, ranges)).toBe(false);
    },
  );

  test("never matches a malformed range or an empty list", () => {
    expect(ipInRanges("1.2.3.4", ["1.2.3.0/33", "1.2.3.0", "x/8"])).toBe(false);
    expect(ipInRanges("1.2.3.4", [])).toBe(false);
  });

  test("does not match across address families", () => {
    expect(ipInRanges("::1", ["0.0.0.0/0"])).toBe(false);
  });
});
