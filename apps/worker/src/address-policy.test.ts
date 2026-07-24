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
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.254",
    "198.51.100.10",
    "203.0.113.5",
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
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::1",
    "100::1",
    "2001::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "100:0:0:1::1",
    "1fff:ffff::1",
    "3fff::1",
    "3fff:0fff::1",
    "4000::1",
    "5f00::1",
  ])("rejects non-public address %s", (address) => {
    expect(isAllowedAddress(address)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "::ffff:8.8.8.8",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
  ])("allows public address %s", (address) => {
    expect(isAllowedAddress(address)).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isAllowedAddress("example.com")).toBe(false);
    expect(isAllowedAddress("999.1.1.1")).toBe(false);
  });
});
