import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { webcrypto, randomUUID, createHash } from 'node:crypto';
import * as accounts from '../account_core.js';
import * as merge from '../../../core/pass_core/js/sync_merge_core.js';
import * as policy from '../../../core/pass_core/js/sync_policy.js';
import * as outbox from '../sync_outbox.js';
import { buildSyncOperationReport } from '../sync_report.js';
import { encryptSyncBundleDocument, decryptSyncBundleDocument, syncEncryptionKeyId } from '../sync_crypto.js';
import { normalizeSyncEncryptionKey } from '../sync_crypto.js';

// 只加载当前工作区的真实编排、标准化、写入和冲突重试函数；替换网络及浏览器存储。
const source = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
function between(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `无法定位源码：${start}`);
  return source.slice(a, b);
}
const code = [
  between('async function runAutoSyncInternal(', 'async function readBusinessDataFromStore('),
  between('function normalizeSyncPayloadShape(', 'async function broadcastWebBridgeData('),
  between('async function writeBusinessDataToStore(', 'async function buildRemoteSyncTargetsFromStorage('),
  between('function asTimestamp(', 'function parseSyncBundlePayload('),
  between('function parseSyncBundlePayload(', 'async function getDeviceName('),
  between('async function buildSyncBundleFromPayload(', 'function base64EncodeUtf8('),
  between('async function pullRemotePayload(', 'function updateRemoteConcurrencyState('),
  between('function updateRemoteConcurrencyState(', 'async function verifySelfHostedWriteReceipt('),
  between('async function verifySelfHostedWriteReceipt(', 'async function getOrCreateSyncEncryptionKey('),
  between('async function pushRemotePayloadWithRetry(', 'function createAccount('),
  between('function handleWebBridgeSyncData(', 'async function configureWebSyncFromBridge('),
].join('\n');
const clone = (value) => structuredClone(value);

function harness({ key = '', fallbackKeys = [], mode = 'merge', beforePut = null } = {}) {
  let current;
  let revision = 0;
  let queue = [];
  const targets = [];
  const remote = new Map();
  const puts = [];
  const snapshots = [];
  const writes = [];
  const context = vm.createContext({
    ...accounts, ...policy, ...outbox,
    crypto: webcrypto, TextEncoder, TextDecoder, URL, Response, console,
    evaluateSyncSafety: merge.evaluateSyncSafety,
    mergeSyncPayloadsCore: merge.mergeSyncPayloads,
    mergeAccountCollectionsCore: merge.mergeAccountCollections,
    mergeFolderCollectionsCore: merge.mergeFolderCollections,
    mergePasskeyCollectionsCore: merge.mergePasskeyCollections,
    reconcileAccountFoldersCore: merge.reconcileAccountFolders,
    SYNC_MODE_MERGE: 'merge',
    SYNC_BUNDLE_SCHEMA_V2: 'pass.sync.bundle.v2',
    PASS_EXTENSION_VERSION: 'test',
    buildSyncOperationReport,
    encryptSyncBundleDocument,
    decryptSyncBundleDocument,
    syncEncryptionKeyId,
    createSyncIdempotencyKey: () => randomUUID(),
    visibleSyncCount: (items) => (items || []).filter((item) => !item.isPermanentlyDeleted).length,
    logSyncFlow: () => {},
    webBridgeSyncChain: Promise.resolve(),
    getBackgroundLockStatus: async () => ({ locked: false }),
    buildRemoteSyncTargetsFromStorage: async () => targets,
    getOrCreateSyncEncryptionKey: async () => key,
    getSyncDecryptionFallbackKeys: async () => fallbackKeys,
    getDeviceName: async () => 'review-device',
    getOrCreateSyncDeviceId: async () => '00000000-0000-4000-8000-000000000099',
    readBusinessDataFromStore: async () => clone(current),
    getAllDataSnapshotFromDataStore: async () => ({ payload: clone(current), revision }),
    setAllDataToDataStore: async (payload, { expectedRevision = null } = {}) => {
      if (expectedRevision != null && expectedRevision !== revision) throw Object.assign(new Error("本地已变化"), { code: "LOCAL_CHANGED" });
      current = clone(payload);
      writes.push(clone(payload));
      return ++revision;
    },
    broadcastWebBridgeData: async () => {},
    saveLocalSafetySnapshot: async () => { snapshots.push(clone(current)); },
    appendHistoryEntry: async () => {},
    getSyncOutbox: async () => clone(queue),
    setSyncOutbox: async (value) => { queue = clone(value); },
    advancePendingOutboxAfterPullFailure: async () => false,
    // 仅在 HTTP 边界注入响应，真实拉取解析、加解密、回执检查均参与执行。
    fetchWithSyncTimeout: async (url, options = {}) => {
      const state = remote.get(url);
      const target = targets.find((item) => item.url === url);
      if (options.method === 'GET') {
        if (state.payload == null) return new Response(null, { status: 404 });
        const document = { schema: 'pass.sync.bundle.v2', exportedAtMs: 1, source: {}, payload: clone(state.payload) };
        const wire = state.encrypted ? await encryptSyncBundleDocument(document, state.wireKey) : document;
        return new Response(JSON.stringify(wire), { status: 200, headers: { ETag: state.etag, 'X-Sync-Revision': String(state.revision) } });
      }
      assert.equal(options.method, 'PUT');
      const wire = JSON.parse(options.body);
      const document = await decryptSyncBundleDocument(wire, key);
      const payload = document.payload;
      const ifMatch = options.headers['If-Match'];
      const idempotencyKey = options.headers['Idempotency-Key'];
      const item = { target: target.url, payload: clone(payload), ifMatch, idempotencyKey };
      puts.push(item);
      if (beforePut) {
        try { await beforePut({ context, target, payload: clone(payload), puts, remote, current: clone(current) }); }
        catch (error) {
          if (error.status) return new Response('', { status: error.status });
          throw error;
        }
      }
      state.payload = clone(payload);
      state.encrypted = wire.schema === 'pass.sync.encrypted.v1';
      state.wireKey = key;
      state.revision += 1;
      state.etag = `"revision-${state.revision}"`;
      const payloadSha256 = createHash('sha256').update(options.body).digest('hex');
      const receipt = { ok: true, committed: true, scope: 'synthetic', etag: state.etag, payloadSha256, revision: state.revision, idempotencyKey };
      return new Response(JSON.stringify(receipt), { status: 200, headers: { ETag: state.etag, 'X-Sync-Revision': String(state.revision), 'X-Sync-Scope': receipt.scope, 'X-Payload-Sha256': payloadSha256, 'X-Sync-Idempotency-Key': idempotencyKey } });
    },
  });
  vm.runInContext(code, context, { filename: 'background-production-functions.js' });
  return {
    context, targets, remote, puts, snapshots, writes,
    setLocal(payload) { current = clone(context.normalizeSyncPayloadShape(payload)); revision += 1; },
    local() { return clone(current); },
    queue() { return clone(queue); },
    addTarget(name, payload, { primary = true, encrypted = false, wireKey = key } = {}) {
      const target = { kind: primary ? 'server' : 'webdav', url: `https://${name}.invalid/sync`, label: name, isPrimary: primary, supportsEtag: true };
      targets.push(target);
      remote.set(target.url, { payload: payload == null ? null : clone(payload), etag: payload == null ? null : '"revision-1"', encrypted, wireKey, revision: 1 });
      return target;
    },
    run(requestedMode = mode, options = {}) { return context.runAutoSyncInternal('synthetic-review-session', { mode: requestedMode, ...options }); },
  };
}
const accountA = {
  recordId: '00000000-0000-4000-8000-000000000001', accountId: 'synthetic-a',
  canonicalSite: 'example.test', sites: ['example.test'], username: 'synthetic-a',
  password: 'synthetic-before', note: 'before', createdAtMs: 100, updatedAtMs: 100,
  passwordUpdatedAtMs: 100, noteUpdatedAtMs: 100, lastOperatedDeviceName: 'review-device',
};
const accountB = { ...accountA, recordId: '00000000-0000-4000-8000-000000000002', accountId: 'synthetic-b', username: 'synthetic-b', sites: ['other.test'], canonicalSite: 'other.test' };
const base = { accounts: [accountA], folders: [], passkeys: [], allRegularAccountIds: [accountA.recordId], allRegularOrderUpdatedAtMs: 100, allRegularOrderUpdatedDeviceName: 'review-device' };

for (const mode of ['merge', 'localOverwriteRemote']) {
  test(`${mode} 上传期间的管理页编辑不会被同步回写覆盖`, async () => {
    const h = harness({ mode, beforePut: async ({ context, current }) => {
      current.accounts[0].note = 'edited-during-upload';
      current.accounts[0].noteUpdatedAtMs = 200;
      current.accounts[0].updatedAtMs = 200;
      assert.equal((await context.handleWebBridgeSyncData(current)).ok, true);
    } });
    h.setLocal(base);
    h.addTarget('primary', null);
    const result = await h.run();
    assert.equal(h.local().accounts[0].note, 'edited-during-upload');
    assert.equal(result.report.ok, false);
    assert.equal(result.report.code, 'LOCAL_CHANGED');
    assert.equal(result.report.retryable, true);
    assert.equal(h.queue().length, 0);
  });
}

test('业务内容相同也要从旧密钥轮换到新密钥', async () => {
  const oldKey = Buffer.alloc(32, 1).toString('base64url');
  const newKey = Buffer.alloc(32, 2).toString('base64url');
  const h = harness({ key: newKey, fallbackKeys: [oldKey], mode: 'localOverwriteRemote' });
  h.setLocal(base);
  const target = h.addTarget('primary', h.local(), { encrypted: true, wireKey: oldKey });
  assert.equal((await h.run()).report.ok, true);
  assert.equal(h.puts.length, 1);
  assert.equal(h.remote.get(target.url).wireKey, newKey);
  const envelope = await encryptSyncBundleDocument({ schema: 'pass.sync.bundle.v2', payload: h.local() }, newKey);
  assert.deepEqual((await decryptSyncBundleDocument(envelope, newKey)).payload, h.local());
  await assert.rejects(() => decryptSyncBundleDocument(envelope, oldKey), /密钥 ID 不匹配/);
  assert.equal((await h.run()).report.ok, true);
  assert.equal(h.puts.length, 1, '新密钥和载荷均相同才跳过重复上传');
});

test('轮换上传失败后，旧密钥的相同内容不能作为成功回执', async () => {
  const oldKey = Buffer.alloc(32, 1).toString('base64url');
  const newKey = Buffer.alloc(32, 2).toString('base64url');
  const h = harness({ key: newKey, fallbackKeys: [oldKey], mode: 'localOverwriteRemote',
    beforePut: () => { throw Object.assign(new Error('HTTP 503'), { status: 503 }); } });
  h.setLocal(base);
  const target = h.addTarget('primary', h.local(), { encrypted: true, wireKey: oldKey });
  const result = await h.run();
  assert.equal(result.report.ok, false);
  assert.equal(result.report.pendingRetry, true);
  assert.equal(h.remote.get(target.url).wireKey, oldKey);
  assert.equal(h.queue()[0].mode, 'localOverwriteRemote');
});

test('配置密钥时继续拒绝明文远端，不能绕过加密入口', async () => {
  const h = harness({ key: Buffer.alloc(32, 3).toString('base64url') });
  h.setLocal(base);
  h.addTarget('primary', h.local());
  assert.equal((await h.run()).report.ok, false);
  assert.equal(h.puts.length, 0);
});

const permanentlyDelete = (account) => ({ ...account, isDeleted: true, isPermanentlyDeleted: true,
  deletedAtMs: 300, updatedAtMs: 300, password: '', note: '' });

for (const conflict of [false, true]) {
  test(`镜像${conflict ? '冲突回读' : '首次上传'}必须保护永久删除墓碑`, async () => {
    const h = harness({ beforePut: ({ target, remote }) => {
      if (!conflict || target.isPrimary) return;
      const state = remote.get(target.url);
      state.payload.accounts[0] = permanentlyDelete(state.payload.accounts[0]);
      state.etag = '"revision-2"';
      throw Object.assign(new Error('HTTP 412'), { status: 412 });
    } });
    h.setLocal(base);
    h.addTarget('primary', h.local());
    const mirrorPayload = h.local();
    mirrorPayload.accounts[0] = conflict
      ? { ...mirrorPayload.accounts[0], password: 'older', passwordUpdatedAtMs: 50 }
      : permanentlyDelete(mirrorPayload.accounts[0]);
    const mirror = h.addTarget('mirror', mirrorPayload, { primary: false });
    const result = await h.run();
    assert.equal(result.report.ok, false);
    assert.equal(result.report.code, 'SAFETY_BLOCKED');
    assert.equal(result.report.safe, false);
    assert.equal(h.remote.get(mirror.url).payload.accounts[0].isPermanentlyDeleted, true);
    assert.equal(h.puts.filter((item) => item.target === mirror.url).length, conflict ? 1 : 0);
  });
}

test('文件夹标准化保留内部排序及其时钟和设备', () => {
  const h = harness();
  const input = { id: '00000000-0000-4000-8000-000000000011', name: 'synthetic-folder',
    createdAtMs: 100, updatedAtMs: 100, regularAccountIds: [accountB.recordId, accountA.recordId],
    regularOrderUpdatedAtMs: 200, regularOrderUpdatedDeviceName: 'review-device' };
  const output = clone(h.context.normalizeFolderShape(input));
  assert.deepEqual(output.regularAccountIds, input.regularAccountIds);
  assert.equal(output.regularOrderUpdatedAtMs, 200);
  assert.equal(output.regularOrderUpdatedDeviceName, 'review-device');
});

test('主源冲突合并的完整排序同时保留在本地和镜像', async () => {
  const h = harness({ beforePut: ({ target, puts, remote }) => {
    if (puts.length !== 1) return;
    const state = remote.get(target.url);
    state.payload.allRegularAccountIds = [accountB.recordId, accountA.recordId];
    state.payload.allRegularOrderUpdatedAtMs = 500;
    state.etag = '"revision-2"';
    throw Object.assign(new Error('HTTP 412'), { status: 412 });
  } });
  h.setLocal({ ...base, accounts: [accountA, accountB], allRegularAccountIds: [accountA.recordId, accountB.recordId] });
  const oldRemote = h.local();
  oldRemote.accounts[0].password = 'synthetic-older';
  oldRemote.accounts[0].passwordUpdatedAtMs = 50;
  const primary = h.addTarget('primary', oldRemote);
  const mirror = h.addTarget('mirror', oldRemote, { primary: false });
  assert.equal((await h.run()).report.ok, true);
  for (const payload of [h.local(), h.remote.get(primary.url).payload, h.remote.get(mirror.url).payload]) {
    assert.equal(payload.allRegularOrderUpdatedAtMs, 500);
    assert.deepEqual(payload.allRegularAccountIds, [accountB.recordId, accountA.recordId]);
  }
});

test('连续冲突后仍保留本轮已接收并落盘的墓碑', async () => {
  const h = harness({ beforePut: ({ target, puts, remote }) => {
    if (puts.length > 2) return;
    const state = remote.get(target.url);
    state.payload.accounts = state.payload.accounts.filter((item) => item.recordId !== accountB.recordId);
    state.etag = `"revision-${puts.length + 1}"`;
    throw Object.assign(new Error('HTTP 412'), { status: 412 });
  } });
  h.setLocal(base);
  const initialRemote = h.local();
  initialRemote.accounts.push(permanentlyDelete(accountB));
  const primary = h.addTarget('primary', initialRemote);
  assert.equal((await h.run()).report.ok, true);
  assert.equal(h.puts.length, 3);
  for (const payload of [h.local(), h.remote.get(primary.url).payload]) {
    assert.equal(payload.accounts.find((item) => item.recordId === accountB.recordId).isPermanentlyDeleted, true);
  }
});

for (const resumeOutbox of [true, false]) {
  test(`${resumeOutbox ? '恢复补偿保留本地覆盖' : '新手动合并不继承旧覆盖'}意图`, async () => {
    const h = harness({ mode: 'localOverwriteRemote', beforePut: ({ puts }) => {
      if (puts.length === 1) throw Object.assign(new Error('HTTP 503'), { status: 503 });
    } });
    h.setLocal(base);
    const oldRemote = h.local();
    oldRemote.accounts[0].password = 'cloud-newer';
    oldRemote.accounts[0].passwordUpdatedAtMs = 200;
    oldRemote.accounts[0].updatedAtMs = 200;
    const target = h.addTarget('primary', oldRemote);
    assert.equal((await h.run()).report.pendingRetry, true);
    assert.equal(h.queue()[0].mode, 'localOverwriteRemote');
    const result = await h.run('merge', { forceOutboxRetry: true, resumeOutbox });
    assert.equal(result.report.ok, true);
    assert.equal(result.report.mode, resumeOutbox ? 'localOverwriteRemote' : 'merge');
    assert.equal(h.remote.get(target.url).payload.accounts[0].password, resumeOutbox ? accountA.password : 'cloud-newer');
    assert.equal(h.local().accounts[0].password, resumeOutbox ? accountA.password : 'cloud-newer');
    assert.equal(h.queue().length, 0);
  });
}

test('冲突后的上传失败把最新候选和排序保存到补偿任务', async () => {
  const h = harness({ beforePut: ({ target, puts, remote }) => {
    if (puts.length === 1) {
      remote.get(target.url).payload.allRegularOrderUpdatedAtMs = 500;
      throw Object.assign(new Error('HTTP 412'), { status: 412 });
    }
    throw Object.assign(new Error('HTTP 503'), { status: 503 });
  } });
  h.setLocal(base);
  const remote = h.local();
  remote.accounts[0].passwordUpdatedAtMs = 50;
  remote.accounts[0].password = 'older';
  h.addTarget('primary', remote);
  assert.equal((await h.run()).report.pendingRetry, true);
  assert.equal(h.queue()[0].payload.allRegularOrderUpdatedAtMs, 500);
  assert.equal(h.local().allRegularOrderUpdatedAtMs, 500);
});

test('快照备份之后、事务提交之前的本地编辑也不会被覆盖', async () => {
  const h = harness();
  h.setLocal(base);
  const cloud = h.local();
  cloud.accounts[0].note = 'cloud-newer';
  cloud.accounts[0].noteUpdatedAtMs = 300;
  h.addTarget('primary', cloud);
  h.context.saveLocalSafetySnapshot = async () => {
    const edited = h.local();
    edited.accounts[0].note = 'edited-after-check';
    edited.accounts[0].noteUpdatedAtMs = 400;
    await h.context.handleWebBridgeSyncData(edited);
  };
  const result = await h.run();
  assert.equal(result.report.code, 'LOCAL_CHANGED');
  assert.equal(h.local().accounts[0].note, 'edited-after-check');
  assert.equal(h.puts.length, 0);
});

test('Firefox 与 Safari 的手动和补偿入口调用同一后台并传递原意图', async () => {
  const h = harness({ beforePut: ({ puts }) => {
    if (puts.length === 1) throw Object.assign(new Error('HTTP 503'), { status: 503 });
  } });
  h.setLocal(base);
  const cloud = h.local();
  cloud.accounts[0].password = 'cloud-newer';
  cloud.accounts[0].passwordUpdatedAtMs = 300;
  const target = h.addTarget('primary', cloud);
  const requests = [];
  Object.assign(h.context, {
    syncInFlight: false, editingAccountId: null, normalizeSyncEncryptionKey,
    dom: { syncEncryptionKey: { value: '' } },
    saveSyncSettings: async () => true, confirmPlaintextSync: () => true, confirmOverwriteSync: () => true,
    refresh: async () => {}, refreshSyncOutboxStatus: async () => {}, setStatus: () => {},
    chrome: { runtime: { sendMessage: async (message) => {
      requests.push(clone(message));
      return { ok: true, result: await h.run(message.payload.mode, message.payload) };
    } } },
  });
  const options = readFileSync(new URL('../options.js', import.meta.url), 'utf8');
  vm.runInContext(options.slice(options.indexOf('async function syncNowWithRemote('),
    options.indexOf('async function confirmRemoteOverwriteLocalIfNeeded(')), h.context);
  assert.equal(await h.context.syncNowWithRemote('localOverwriteRemote'), false);
  assert.equal(await h.context.syncNowWithRemote('merge', true, true), true);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].type, 'PASS_SYNC_RUN');
  assert.equal(requests[1].payload.resumeOutbox, true);
  assert.equal(h.remote.get(target.url).payload.accounts[0].password, accountA.password);
});
