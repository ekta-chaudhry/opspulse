import { describe, expect, it } from "vitest";
import { isAllowedAddress } from "./address-policy.js";

describe("isAllowedAddress", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:192.168.1.1",
  ])("rejects non-public address %s", (address) => {
    expect(isAllowedAddress(address)).toBe(false);
  });

  it.each([
    "192.0.2.1",
    "198.51.100.10",
    "203.0.113.5",
    "2001:db8::1",
    "2606:4700:4700::1111",
  ])("allows public and documentation address %s", (address) => {
    expect(isAllowedAddress(address)).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isAllowedAddress("example.com")).toBe(false);
    expect(isAllowedAddress("999.1.1.1")).toBe(false);
  });
});
