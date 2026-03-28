import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';

typedef _InitNative = Int32 Function();
typedef _InitDart = int Function();

typedef _ShutdownNative = Void Function();
typedef _ShutdownDart = void Function();

typedef _HealthNative = Pointer<Utf8> Function();
typedef _HealthDart = Pointer<Utf8> Function();

typedef _VersionNative = Pointer<Utf8> Function();
typedef _VersionDart = Pointer<Utf8> Function();

typedef _PingNative = Int32 Function();
typedef _PingDart = int Function();

typedef _CompareBoundsNative = Int32 Function(Int64, Int64, Int64, Int64);
typedef _CompareBoundsDart = int Function(int, int, int, int);

typedef _StateUpsertNative = Pointer<Utf8> Function(
    Pointer<Utf8>, Pointer<Utf8>);
typedef _StateUpsertDart = Pointer<Utf8> Function(Pointer<Utf8>, Pointer<Utf8>);

typedef _SoftDeleteNative = Pointer<Utf8> Function(
    Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>);
typedef _SoftDeleteDart = Pointer<Utf8> Function(
    Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>);

typedef _RestoreNative = Pointer<Utf8> Function(
    Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>);
typedef _RestoreDart = Pointer<Utf8> Function(
    Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>);

typedef _HardDeleteNative = Pointer<Utf8> Function(
    Pointer<Utf8>, Pointer<Utf8>);
typedef _HardDeleteDart = Pointer<Utf8> Function(Pointer<Utf8>, Pointer<Utf8>);

typedef _SyncAliasNative = Pointer<Utf8> Function(Pointer<Utf8>);
typedef _SyncAliasDart = Pointer<Utf8> Function(Pointer<Utf8>);

typedef _ExportCsvNative = Pointer<Utf8> Function(Pointer<Utf8>);
typedef _ExportCsvDart = Pointer<Utf8> Function(Pointer<Utf8>);

typedef _LastErrorNative = Pointer<Utf8> Function();
typedef _LastErrorDart = Pointer<Utf8> Function();

typedef _StringFreeNative = Void Function(Pointer<Utf8>);
typedef _StringFreeDart = void Function(Pointer<Utf8>);

class RustBridge {
  RustBridge._({
    required this.libraryPath,
    required _InitDart init,
    required _ShutdownDart shutdown,
    required _HealthDart health,
    required _VersionDart version,
    required _PingDart ping,
    required _CompareBoundsDart compareBounds,
    required _StateUpsertDart stateUpsert,
    required _SoftDeleteDart stateSoftDelete,
    required _RestoreDart stateRestore,
    required _HardDeleteDart stateHardDelete,
    required _SyncAliasDart stateSyncAlias,
    required _ExportCsvDart exportAccountsCsv,
    required _LastErrorDart lastError,
    required _StringFreeDart stringFree,
  })  : _init = init,
        _shutdown = shutdown,
        _health = health,
        _version = version,
        _ping = ping,
        _compareBounds = compareBounds,
        _stateUpsert = stateUpsert,
        _stateSoftDelete = stateSoftDelete,
        _stateRestore = stateRestore,
        _stateHardDelete = stateHardDelete,
        _stateSyncAlias = stateSyncAlias,
        _exportAccountsCsv = exportAccountsCsv,
        _lastError = lastError,
        _stringFree = stringFree;

  final String libraryPath;
  final _InitDart _init;
  final _ShutdownDart _shutdown;
  final _HealthDart _health;
  final _VersionDart _version;
  final _PingDart _ping;
  final _CompareBoundsDart _compareBounds;
  final _StateUpsertDart _stateUpsert;
  final _SoftDeleteDart _stateSoftDelete;
  final _RestoreDart _stateRestore;
  final _HardDeleteDart _stateHardDelete;
  final _SyncAliasDart _stateSyncAlias;
  final _ExportCsvDart _exportAccountsCsv;
  final _LastErrorDart _lastError;
  final _StringFreeDart _stringFree;

  bool _initialized = false;

  static RustBridge? _instance;

  static RustBridge get instance {
    final bridge = _instance;
    if (bridge == null) {
      throw StateError('RustBridge 未初始化');
    }
    return bridge;
  }

  static bool get isReady => _instance != null;

  static Future<RustBridge> ensureLoaded() async {
    final existing = _instance;
    if (existing != null) return existing;

    final libPath = await _resolveLibraryPath();
    final lib = DynamicLibrary.open(libPath);
    final bridge = RustBridge._(
      libraryPath: libPath,
      init: lib.lookupFunction<_InitNative, _InitDart>('pass_core_init'),
      shutdown: lib
          .lookupFunction<_ShutdownNative, _ShutdownDart>('pass_core_shutdown'),
      health:
          lib.lookupFunction<_HealthNative, _HealthDart>('pass_core_health'),
      version:
          lib.lookupFunction<_VersionNative, _VersionDart>('pass_core_version'),
      ping: lib.lookupFunction<_PingNative, _PingDart>('pass_core_ping'),
      compareBounds:
          lib.lookupFunction<_CompareBoundsNative, _CompareBoundsDart>(
              'pass_core_compare_bounds'),
      stateUpsert: lib.lookupFunction<_StateUpsertNative, _StateUpsertDart>(
          'pass_core_state_upsert_account'),
      stateSoftDelete: lib.lookupFunction<_SoftDeleteNative, _SoftDeleteDart>(
          'pass_core_state_soft_delete_account'),
      stateRestore: lib.lookupFunction<_RestoreNative, _RestoreDart>(
          'pass_core_state_restore_account'),
      stateHardDelete: lib.lookupFunction<_HardDeleteNative, _HardDeleteDart>(
          'pass_core_state_hard_delete_account'),
      stateSyncAlias: lib.lookupFunction<_SyncAliasNative, _SyncAliasDart>(
          'pass_core_state_sync_alias'),
      exportAccountsCsv: lib.lookupFunction<_ExportCsvNative, _ExportCsvDart>(
          'pass_core_export_accounts_csv'),
      lastError: lib.lookupFunction<_LastErrorNative, _LastErrorDart>(
          'pass_core_last_error_message'),
      stringFree: lib.lookupFunction<_StringFreeNative, _StringFreeDart>(
          'pass_core_string_free'),
    );
    bridge.init();
    _instance = bridge;
    return bridge;
  }

  static Future<String> _resolveLibraryPath() async {
    final fromEnv = Platform.environment['PASS_CORE_LIB_PATH'];
    if (fromEnv != null && File(fromEnv).existsSync()) return fromEnv;

    final fileName = switch (Platform.operatingSystem) {
      'macos' => 'libpass_core_ffi.dylib',
      'windows' => 'pass_core_ffi.dll',
      _ => 'libpass_core_ffi.so',
    };

    final candidates = <String>[
      '${Directory.current.path}/$fileName',
      '${Directory.current.path}/../core/pass_core/target/debug/$fileName',
      '${Directory.current.path}/../../core/pass_core/target/debug/$fileName',
      '${Directory.current.path}/../core/pass_core/target/release/$fileName',
      '${Directory.current.path}/../../core/pass_core/target/release/$fileName',
    ];

    for (final path in candidates) {
      if (File(path).existsSync()) return path;
    }

    throw StateError(
      '未找到 Rust FFI 动态库($fileName)。请先构建: '
      'cd core/pass_core && cargo build -p pass-core-ffi',
    );
  }

  void init() {
    final code = _init();
    if (code != 0) {
      throw StateError('pass_core_init failed: $code');
    }
    _initialized = true;
  }

  void shutdown() {
    if (_initialized) {
      _shutdown();
      _initialized = false;
    }
  }

  String health() => _health().toDartString();
  String version() => _version().toDartString();
  int ping() => _ping();
  int compareBounds(int aLower, int aUpper, int bLower, int bUpper) =>
      _compareBounds(aLower, aUpper, bLower, bUpper);

  String stateUpsertAccount(String stateJson, String accountJson) =>
      _callString2(_stateUpsert, stateJson, accountJson);

  String stateSoftDeleteAccount(
    String stateJson,
    String accountId,
    String deletedAtIso,
    String updatedAtIso,
  ) =>
      _callString4(
          _stateSoftDelete, stateJson, accountId, deletedAtIso, updatedAtIso);

  String stateRestoreAccount(
    String stateJson,
    String accountId,
    String updatedAtIso,
  ) =>
      _callString3(_stateRestore, stateJson, accountId, updatedAtIso);

  String stateHardDeleteAccount(String stateJson, String accountId) =>
      _callString2(_stateHardDelete, stateJson, accountId);

  String stateSyncAlias(String stateJson) =>
      _callString1(_stateSyncAlias, stateJson);

  String exportAccountsCsv(String stateJson) =>
      _callString1(_exportAccountsCsv, stateJson);

  String _readLastError() {
    final ptr = _lastError();
    if (ptr == nullptr) return 'Rust 返回空错误';
    return ptr.toDartString();
  }

  String _callString1(Pointer<Utf8> Function(Pointer<Utf8>) fn, String arg1) {
    final p1 = arg1.toNativeUtf8();
    try {
      final raw = fn(p1);
      return _consumeRustOwnedString(raw);
    } finally {
      malloc.free(p1);
    }
  }

  String _callString2(Pointer<Utf8> Function(Pointer<Utf8>, Pointer<Utf8>) fn,
      String arg1, String arg2) {
    final p1 = arg1.toNativeUtf8();
    final p2 = arg2.toNativeUtf8();
    try {
      final raw = fn(p1, p2);
      return _consumeRustOwnedString(raw);
    } finally {
      malloc.free(p1);
      malloc.free(p2);
    }
  }

  String _callString3(
      Pointer<Utf8> Function(Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>) fn,
      String arg1,
      String arg2,
      String arg3) {
    final p1 = arg1.toNativeUtf8();
    final p2 = arg2.toNativeUtf8();
    final p3 = arg3.toNativeUtf8();
    try {
      final raw = fn(p1, p2, p3);
      return _consumeRustOwnedString(raw);
    } finally {
      malloc.free(p1);
      malloc.free(p2);
      malloc.free(p3);
    }
  }

  String _callString4(
      Pointer<Utf8> Function(
              Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>, Pointer<Utf8>)
          fn,
      String arg1,
      String arg2,
      String arg3,
      String arg4) {
    final p1 = arg1.toNativeUtf8();
    final p2 = arg2.toNativeUtf8();
    final p3 = arg3.toNativeUtf8();
    final p4 = arg4.toNativeUtf8();
    try {
      final raw = fn(p1, p2, p3, p4);
      return _consumeRustOwnedString(raw);
    } finally {
      malloc.free(p1);
      malloc.free(p2);
      malloc.free(p3);
      malloc.free(p4);
    }
  }

  String _consumeRustOwnedString(Pointer<Utf8> ptr) {
    if (ptr == nullptr) {
      throw StateError(_readLastError());
    }
    final value = ptr.toDartString();
    _stringFree(ptr);
    return value;
  }
}
