import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeProvisionCredential,
  validateProvisionInput,
  generateProvisionToken,
  parseExistingServiceError,
  formatProvisionReplacement,
  formatBundleImportDetails,
  provisionStageMessage,
  formatServerVersionLabel,
  formatLocalSnapshotLabel,
  splitSitesInput,
  normalizeProvisionDraft,
  formatGoogleAuthImportSummary,
  formatCsvImportSummary,
  formatFolderSiteRuleSummary,
} from "../../codex-tauri/src/provision.js";

test("normalizeProvisionCredential sets safe defaults and trims inputs", () => {
  const empty = normalizeProvisionCredential();
  assert.deepEqual(empty, {
    username: "root",
    port: 22,
    authMode: "privateKey",
    secret: "",
    privateKeyPassphrase: "",
  });

  const custom = normalizeProvisionCredential({
    username: "  admin  ",
    port: "2222",
    authMode: "password",
    secret: "supersecret",
    privateKeyPassphrase: "keypass",
  });
  assert.deepEqual(custom, {
    username: "admin",
    port: 2222,
    authMode: "password",
    secret: "supersecret",
    privateKeyPassphrase: "keypass",
  });
});

test("validateProvisionInput validates HTTPS and SSH secrets strictly", () => {
  assert.deepEqual(validateProvisionInput({ serverUrl: "http://sync.example.com" }), {
    valid: false,
    error: "服务器地址必须是 HTTPS URL",
  });
  assert.deepEqual(validateProvisionInput({ serverUrl: "https://sync.example.com", credential: { secret: "   " } }), {
    valid: false,
    error: "请填写 SSH 密码或私钥",
  });
  assert.deepEqual(
    validateProvisionInput({
      serverUrl: "https://sync.example.com:8443",
      credential: { secret: "-----BEGIN RSA PRIVATE KEY-----" },
    }),
    { valid: true, error: null }
  );
});

test("generateProvisionToken produces URL-safe token without +, / or padding", () => {
  // Deterministic mock random generator
  const mockRandom = (bytes) => {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i * 7;
    }
  };
  const token = generateProvisionToken(mockRandom);
  assert.equal(typeof token, "string");
  assert.ok(token.length > 20);
  assert.equal(token.includes("+"), false);
  assert.equal(token.includes("/"), false);
  assert.equal(token.includes("="), false);
});

test("parseExistingServiceError parses conflict host and bullet findings", () => {
  assert.equal(parseExistingServiceError("Connection reset by peer"), null);
  assert.equal(parseExistingServiceError(""), null);

  const raw = "EXISTING_SERVICE:192.168.1.100|docker 容器已运行；端口 443 已占用；存在旧数据目录";
  const parsed = parseExistingServiceError(raw);
  assert.ok(parsed);
  assert.equal(parsed.isExistingService, true);
  assert.equal(parsed.host, "192.168.1.100");
  assert.equal(parsed.summary, "检测到服务器 192.168.1.100 上已有 Pass 同步服务。");
  assert.deepEqual(parsed.findings, ["docker 容器已运行", "端口 443 已占用", "存在旧数据目录"]);
});

test("formatProvisionReplacement formats confirmation findings cleanly", () => {
  const emptyReport = formatProvisionReplacement(null);
  assert.equal(emptyReport.summary, "服务器上已存在 Pass 同步服务。");
  assert.equal(emptyReport.hasFindings, false);
  assert.equal(emptyReport.findingsText, "");

  const fullReport = formatProvisionReplacement({
    summary: "检测到已有旧版本服务",
    findings: ["服务 pass-sync.service 正在运行", "数据文件存在于 /var/pass"],
  });
  assert.equal(fullReport.summary, "检测到已有旧版本服务");
  assert.equal(fullReport.hasFindings, true);
  assert.equal(
    fullReport.findingsText,
    "• 服务 pass-sync.service 正在运行\n• 数据文件存在于 /var/pass"
  );
});

test("formatBundleImportDetails formats account metrics and zero-leak diff", () => {
  const result = {
    localAccounts: 10,
    remoteAccounts: 15,
    mergedAccounts: 18,
    reasons: ["远端账号数量显著增加"],
  };
  const diff = {
    total: 2,
    lines: ["• 新增：github.com (alice)", "• 修改：google.com (bob)"],
    omitted: 0,
  };
  const details = formatBundleImportDetails(result, diff);
  assert.ok(details.includes("本地账号：10"));
  assert.ok(details.includes("同步包账号：15"));
  assert.ok(details.includes("合并后账号：18"));
  assert.ok(details.includes("安全检查提示：远端账号数量显著增加"));
  assert.ok(details.includes("具体账号差异（2 条）："));
  assert.ok(details.includes("• 新增：github.com (alice)"));
  assert.ok(details.includes("确认后才会写入本地 vault。"));
});

test("provisionStageMessage yields consistent Chinese UI cues", () => {
  assert.equal(provisionStageMessage("host_key"), "正在确认 SSH 服务器身份…");
  assert.equal(provisionStageMessage("detect"), "正在检测服务器是否已有旧服务…");
  assert.equal(provisionStageMessage("deploy", { removeExisting: false }), "正在通过 SSH 在服务器上创建服务…");
  assert.equal(provisionStageMessage("deploy", { removeExisting: true }), "正在删除旧服务并创建新服务…");
  assert.equal(provisionStageMessage("verify"), "正在验证服务连通性…");
});

test("formatServerVersionLabel and formatLocalSnapshotLabel format metadata cleanly", () => {
  const dummyFormatTime = (ms) => `T:${ms}`;
  const vLabel = formatServerVersionLabel(
    {
      id: 42,
      exportedAtMs: 1700000000000,
      savedAtMs: 1700000005000,
      payloadSha256: "abcdef0123456789deadbeef",
    },
    dummyFormatTime
  );
  assert.equal(vLabel, "版本 42 · 导出 T:1700000000000 · 保存 T:1700000005000 · abcdef012345");

  const sLabel = formatLocalSnapshotLabel(
    {
      reason: "删除账号前备份",
      createdAtMs: 1700000010000,
      accounts: 12,
      folders: 3,
      passkeys: 2,
    },
    dummyFormatTime
  );
  assert.equal(sLabel, "删除账号前备份 · T:1700000010000 · 账号 12 · 文件夹 3 · 通行密钥 2");
});

test("splitSitesInput splits multiple delimiters and filters blanks", () => {
  const sites = splitSitesInput("github.com, gitlab.com\nbitbucket.org，example.com\n   ");
  assert.deepEqual(sites, ["github.com", "gitlab.com", "bitbucket.org", "example.com"]);
});

test("normalizeProvisionDraft trims draft fields", () => {
  const draft = normalizeProvisionDraft({
    serverUrl: "  https://example.com  ",
    tlsCertificate: "cert",
    tlsPrivateKey: "key",
    accessToken: "  token123  ",
    syncEncryptionKey: "  encKey456  ",
  });
  assert.deepEqual(draft, {
    serverUrl: "https://example.com",
    tlsCertificate: "cert",
    tlsPrivateKey: "key",
    accessToken: "token123",
    syncEncryptionKey: "encKey456",
  });
});

test("formatGoogleAuthImportSummary, formatCsvImportSummary and formatFolderSiteRuleSummary format results", () => {
  assert.equal(
    formatGoogleAuthImportSummary({ created: 5, updated: 2, skipped: 1 }),
    "验证器导入完成：新增 5，更新 2，跳过 1"
  );
  assert.equal(formatGoogleAuthImportSummary(null), "验证器导入完成：新增 0，更新 0，跳过 0");

  assert.equal(formatCsvImportSummary({ imported: 12 }), "已导入 12 条");
  assert.equal(formatCsvImportSummary({ message: "自定义成功信息" }), "自定义成功信息");

  assert.equal(formatFolderSiteRuleSummary({ addedCount: 3 }), "已加入 3 个账号");
  assert.equal(formatFolderSiteRuleSummary({ message: "所有站点均已归档" }), "所有站点均已归档");
});
