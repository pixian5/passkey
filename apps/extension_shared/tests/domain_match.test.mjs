import assert from "node:assert/strict";
import { test } from "node:test";
import {
  domainsMatch,
  domainAliasGroupKey,
  etldPlusOne,
  isIpHost,
  normalizeDomain,
  syncAliasGroups,
} from "../account_core.js";

test("IP 地址不会被折叠成共享后缀", () => {
  assert.equal(isIpHost("192.168.1.1"), true);
  assert.equal(isIpHost("10.0.1.1"), true);
  assert.equal(etldPlusOne("192.168.1.1"), "192.168.1.1");
  assert.equal(etldPlusOne("10.0.1.1"), "10.0.1.1");
  assert.notEqual(etldPlusOne("192.168.1.1"), etldPlusOne("10.0.1.1"));
});

test("常见多级公共后缀不会把不同站点判成同域", () => {
  assert.equal(etldPlusOne("bank.com.au"), "bank.com.au");
  assert.equal(etldPlusOne("evil.com.au"), "evil.com.au");
  assert.notEqual(etldPlusOne("bank.com.au"), etldPlusOne("evil.com.au"));
  assert.equal(etldPlusOne("shop.co.jp"), "shop.co.jp");
  assert.equal(etldPlusOne("login.co.uk"), "login.co.uk");
});

test("普通 eTLD+1 与中国多级后缀仍可用", () => {
  assert.equal(etldPlusOne("www.example.com"), "example.com");
  assert.equal(etldPlusOne("a.b.example.com.cn"), "example.com.cn");
  assert.equal(normalizeDomain("HTTPS://Example.COM."), "example.com");
});

test("显式微软域名别名可以跨主域匹配", () => {
  assert.equal(domainAliasGroupKey("login.microsoftonline.com"), "microsoft");
  assert.equal(domainsMatch("microsoft.com", "login.microsoftonline.com"), true);
  assert.equal(domainsMatch("live.com", "outlook.com"), true);
  assert.equal(domainsMatch("microsoft.com", "google.com"), false);
  assert.equal(domainsMatch("evil-microsoftonline.com", "microsoft.com"), false);
});

test("共享账号同步包装会合并微软别名站点", () => {
  const next = syncAliasGroups([
    { sites: ["microsoft.com"] },
    { sites: ["login.microsoftonline.com"] },
  ], { nowMs: 88, deviceName: "Browser" });
  assert.deepEqual(next[0].sites, ["login.microsoftonline.com", "microsoft.com"]);
  assert.deepEqual(next[1].sites, next[0].sites);
});
