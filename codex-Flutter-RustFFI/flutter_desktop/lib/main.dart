import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import 'rust_bridge.dart';

void main() {
  runApp(const PassDesktopApp());
}

class PassDesktopApp extends StatelessWidget {
  const PassDesktopApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Pass Desktop',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const PassHomePage(),
    );
  }
}

class PassHomePage extends StatefulWidget {
  const PassHomePage({super.key});

  @override
  State<PassHomePage> createState() => _PassHomePageState();
}

class _PassHomePageState extends State<PassHomePage> {
  final LocalStore _store = LocalStore();
  bool _loading = true;
  String _deviceName = 'Desktop';
  List<Account> _accounts = [];
  List<Account> _recycleBin = [];
  String _rustStatus = '未初始化';
  String _rustVersion = '-';
  String _rustLibPath = '-';
  int? _rustCompareResult;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    if (RustBridge.isReady) {
      RustBridge.instance.shutdown();
    }
    super.dispose();
  }

  Future<void> _load() async {
    await _ensureRustBridge();
    final state = await _store.load();
    setState(() {
      _deviceName = state.deviceName;
      _accounts = state.accounts.where((e) => !e.deleted).toList();
      _recycleBin = state.accounts.where((e) => e.deleted).toList();
      _loading = false;
    });
  }

  Future<void> _ensureRustBridge() async {
    if (RustBridge.isReady) return;
    try {
      final bridge = await RustBridge.ensureLoaded();
      final compareResult = bridge.compareBounds(0, 10, 11, 20);
      setState(() {
        _rustStatus = '${bridge.health()} / ping=${bridge.ping()}';
        _rustVersion = bridge.version();
        _rustLibPath = bridge.libraryPath;
        _rustCompareResult = compareResult;
      });
    } catch (e) {
      setState(() {
        _rustStatus = '加载失败: $e';
      });
    }
  }

  Future<void> _persistAll(List<Account> all, {String? deviceName}) async {
    final targetState =
        AppState(deviceName: deviceName ?? _deviceName, accounts: all);
    await _store.save(targetState);
    await _loadFromState(targetState);
  }

  Future<void> _loadFromState(AppState state) async {
    setState(() {
      _deviceName = state.deviceName;
      _accounts = state.accounts.where((e) => !e.deleted).toList();
      _recycleBin = state.accounts.where((e) => e.deleted).toList();
      _loading = false;
    });
  }

  AppState _currentState() => AppState(
      deviceName: _deviceName, accounts: [..._accounts, ..._recycleBin]);

  Future<void> _persistStateJsonFromRust(String stateJson) async {
    final next =
        AppState.fromJson(jsonDecode(stateJson) as Map<String, dynamic>);
    await _store.save(next);
    await _loadFromState(next);
  }

  Future<void> _addOrUpdateAccount([Account? account]) async {
    final edited = await showDialog<Account>(
      context: context,
      builder: (_) => AccountDialog(account: account),
    );
    if (edited == null) return;

    try {
      final nextJson = RustBridge.instance.stateUpsertAccount(
        jsonEncode(_currentState().toJson()),
        jsonEncode(edited.copyWith(updatedAt: DateTime.now()).toJson()),
      );
      await _persistStateJsonFromRust(nextJson);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('保存失败: $e')));
    }
  }

  Future<void> _softDelete(Account account) async {
    final now = DateTime.now().toIso8601String();
    try {
      final nextJson = RustBridge.instance.stateSoftDeleteAccount(
        jsonEncode(_currentState().toJson()),
        account.id,
        now,
        now,
      );
      await _persistStateJsonFromRust(nextJson);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('删除失败: $e')));
    }
  }

  Future<void> _restore(Account account) async {
    try {
      final nextJson = RustBridge.instance.stateRestoreAccount(
        jsonEncode(_currentState().toJson()),
        account.id,
        DateTime.now().toIso8601String(),
      );
      await _persistStateJsonFromRust(nextJson);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('恢复失败: $e')));
    }
  }

  Future<void> _hardDelete(Account account) async {
    try {
      final nextJson = RustBridge.instance.stateHardDeleteAccount(
        jsonEncode(_currentState().toJson()),
        account.id,
      );
      await _persistStateJsonFromRust(nextJson);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('彻底删除失败: $e')));
    }
  }

  Future<void> _setDeviceName() async {
    final ctrl = TextEditingController(text: _deviceName);
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('设备名称'),
        content: TextField(controller: ctrl),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('保存')),
        ],
      ),
    );
    if (ok != true) return;
    await _persistAll([..._accounts, ..._recycleBin],
        deviceName: ctrl.text.trim().isEmpty ? 'Desktop' : ctrl.text.trim());
  }

  Future<void> _generateDemo() async {
    final now = DateTime.now();
    final demo = [
      Account.create(
          sites: ['github.com'],
          username: 'alice@example.com',
          password: 'A!ice123',
          note: 'Demo GitHub',
          createdAt: now),
      Account.create(
          sites: ['gitlab.com', 'github.com'],
          username: 'alice-work',
          password: 'Work#2026',
          note: 'Alias demo',
          createdAt: now),
      Account.create(
          sites: ['google.com'],
          username: 'alice@gmail.com',
          password: 'Mail!234',
          createdAt: now),
    ];
    for (final d in demo) {
      final nextJson = RustBridge.instance.stateUpsertAccount(
        jsonEncode(_currentState().toJson()),
        jsonEncode(d.toJson()),
      );
      await _persistStateJsonFromRust(nextJson);
    }
  }

  Future<void> _exportCsv() async {
    try {
      final csv = RustBridge.instance
          .exportAccountsCsv(jsonEncode(_currentState().toJson()));
      final file = await _store.exportCsvString(csv);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('已导出: ${file.path}')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('导出失败: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Text('Pass Desktop · $_deviceName'),
          bottom: const TabBar(
              tabs: [Tab(text: '账号'), Tab(text: '回收站'), Tab(text: '设置')]),
          actions: [
            IconButton(
                onPressed: _exportCsv,
                tooltip: '导出 CSV',
                icon: const Icon(Icons.file_download_outlined)),
            IconButton(
                onPressed: _generateDemo,
                tooltip: '生成示例',
                icon: const Icon(Icons.auto_fix_high_outlined)),
          ],
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => _addOrUpdateAccount(),
          icon: const Icon(Icons.add),
          label: const Text('新建账号'),
        ),
        body: TabBarView(
          children: [
            _AccountList(
              accounts: _accounts,
              onEdit: _addOrUpdateAccount,
              onDelete: _softDelete,
            ),
            _RecycleBinList(
                accounts: _recycleBin,
                onRestore: _restore,
                onDeleteForever: _hardDelete),
            _SettingsPane(
              deviceName: _deviceName,
              accountCount: _accounts.length,
              recycleCount: _recycleBin.length,
              onSetDeviceName: _setDeviceName,
              dataDirFuture: _store.appDataDir(),
              rustStatus: _rustStatus,
              rustVersion: _rustVersion,
              rustLibPath: _rustLibPath,
              rustCompareResult: _rustCompareResult,
            ),
          ],
        ),
      ),
    );
  }
}

class _AccountList extends StatelessWidget {
  const _AccountList(
      {required this.accounts, required this.onEdit, required this.onDelete});

  final List<Account> accounts;
  final Future<void> Function(Account account) onEdit;
  final Future<void> Function(Account account) onDelete;

  @override
  Widget build(BuildContext context) {
    if (accounts.isEmpty) return const Center(child: Text('暂无账号'));
    return ListView.builder(
      itemCount: accounts.length,
      itemBuilder: (_, i) {
        final a = accounts[i];
        return ListTile(
          title: Text('${a.username} @ ${a.sites.join(', ')}'),
          subtitle: Text('更新时间 ${fmt(a.updatedAt)}'),
          onTap: () => onEdit(a),
          trailing: IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: () => onDelete(a)),
        );
      },
    );
  }
}

class _RecycleBinList extends StatelessWidget {
  const _RecycleBinList(
      {required this.accounts,
      required this.onRestore,
      required this.onDeleteForever});

  final List<Account> accounts;
  final Future<void> Function(Account account) onRestore;
  final Future<void> Function(Account account) onDeleteForever;

  @override
  Widget build(BuildContext context) {
    if (accounts.isEmpty) return const Center(child: Text('回收站为空'));
    return ListView.builder(
      itemCount: accounts.length,
      itemBuilder: (_, i) {
        final a = accounts[i];
        return ListTile(
          title: Text(a.username),
          subtitle:
              Text('删除时间 ${a.deletedAt == null ? '-' : fmt(a.deletedAt!)}'),
          leading: IconButton(
              onPressed: () => onRestore(a),
              icon: const Icon(Icons.restore_outlined)),
          trailing: IconButton(
              onPressed: () => onDeleteForever(a),
              icon: const Icon(Icons.delete_forever_outlined)),
        );
      },
    );
  }
}

class _SettingsPane extends StatelessWidget {
  const _SettingsPane({
    required this.deviceName,
    required this.accountCount,
    required this.recycleCount,
    required this.onSetDeviceName,
    required this.dataDirFuture,
    required this.rustStatus,
    required this.rustVersion,
    required this.rustLibPath,
    required this.rustCompareResult,
  });

  final String deviceName;
  final int accountCount;
  final int recycleCount;
  final VoidCallback onSetDeviceName;
  final Future<Directory> dataDirFuture;
  final String rustStatus;
  final String rustVersion;
  final String rustLibPath;
  final int? rustCompareResult;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('设备名称'),
            subtitle: Text(deviceName),
            trailing: FilledButton(
                onPressed: onSetDeviceName, child: const Text('修改')),
          ),
          Text('正常账号: $accountCount'),
          Text('回收站: $recycleCount'),
          const SizedBox(height: 12),
          FutureBuilder<Directory>(
            future: dataDirFuture,
            builder: (context, snapshot) =>
                Text('数据目录: ${snapshot.data?.path ?? '加载中...'}'),
          ),
          const SizedBox(height: 8),
          const Text('时间格式: yy-M-d H:m:s'),
          const SizedBox(height: 12),
          const Divider(),
          const Text('Rust FFI 状态',
              style: TextStyle(fontWeight: FontWeight.bold)),
          Text('health/ping: $rustStatus'),
          Text('version: $rustVersion'),
          Text('compare_bounds(0-10,11-20): ${rustCompareResult ?? '-'}'),
          Text('library: $rustLibPath'),
        ],
      ),
    );
  }
}

class AccountDialog extends StatefulWidget {
  const AccountDialog({super.key, this.account});

  final Account? account;

  @override
  State<AccountDialog> createState() => _AccountDialogState();
}

class _AccountDialogState extends State<AccountDialog> {
  late TextEditingController sites;
  late TextEditingController username;
  late TextEditingController password;
  late TextEditingController totp;
  late TextEditingController recovery;
  late TextEditingController note;

  @override
  void initState() {
    super.initState();
    final a = widget.account;
    sites = TextEditingController(text: a?.sites.join(',') ?? '');
    username = TextEditingController(text: a?.username ?? '');
    password = TextEditingController(text: a?.password ?? '');
    totp = TextEditingController(text: a?.totp ?? '');
    recovery = TextEditingController(text: a?.recovery ?? '');
    note = TextEditingController(text: a?.note ?? '');
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.account == null ? '新建账号' : '编辑账号'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            children: [
              TextField(
                  controller: sites,
                  decoration: const InputDecoration(labelText: '站点 (逗号分隔)')),
              TextField(
                  controller: username,
                  decoration: const InputDecoration(labelText: '用户名')),
              TextField(
                  controller: password,
                  decoration: const InputDecoration(labelText: '密码')),
              TextField(
                  controller: totp,
                  decoration: const InputDecoration(labelText: 'TOTP')),
              TextField(
                  controller: recovery,
                  decoration: const InputDecoration(labelText: '恢复码')),
              TextField(
                  controller: note,
                  decoration: const InputDecoration(labelText: '备注')),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('取消')),
        FilledButton(
          onPressed: () {
            final now = DateTime.now();
            final parsedSites = sites.text
                .split(',')
                .map((e) => e.trim().toLowerCase())
                .where((e) => e.isNotEmpty)
                .toSet()
                .toList();
            if (parsedSites.isEmpty || username.text.trim().isEmpty) {
              return;
            }
            final base = widget.account;
            final account = (base ??
                    Account.create(
                        sites: parsedSites,
                        username: username.text.trim(),
                        password: password.text,
                        createdAt: now))
                .copyWith(
              sites: parsedSites,
              username: username.text.trim(),
              password: password.text,
              totp: totp.text,
              recovery: recovery.text,
              note: note.text,
              updatedAt: now,
            );
            Navigator.pop(context, account);
          },
          child: const Text('保存'),
        ),
      ],
    );
  }
}

String fmt(DateTime dt) =>
    '${dt.year % 100}-${dt.month}-${dt.day} ${dt.hour}:${dt.minute}:${dt.second}';

class Account {
  Account({
    required this.id,
    required this.sites,
    required this.username,
    required this.password,
    required this.createdAt,
    required this.updatedAt,
    this.totp = '',
    this.recovery = '',
    this.note = '',
    this.deletedAt,
  });

  factory Account.create({
    required List<String> sites,
    required String username,
    required String password,
    required DateTime createdAt,
    String totp = '',
    String recovery = '',
    String note = '',
  }) {
    return Account(
      id: const Uuid().v4(),
      sites: sites,
      username: username,
      password: password,
      totp: totp,
      recovery: recovery,
      note: note,
      createdAt: createdAt,
      updatedAt: createdAt,
    );
  }

  final String id;
  final List<String> sites;
  final String username;
  final String password;
  final String totp;
  final String recovery;
  final String note;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? deletedAt;

  bool get deleted => deletedAt != null;

  Account copyWith({
    List<String>? sites,
    String? username,
    String? password,
    String? totp,
    String? recovery,
    String? note,
    DateTime? updatedAt,
    DateTime? deletedAt,
  }) {
    return Account(
      id: id,
      sites: sites ?? this.sites,
      username: username ?? this.username,
      password: password ?? this.password,
      totp: totp ?? this.totp,
      recovery: recovery ?? this.recovery,
      note: note ?? this.note,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      deletedAt: deletedAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'sites': sites,
        'username': username,
        'password': password,
        'totp': totp,
        'recovery': recovery,
        'note': note,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        'deletedAt': deletedAt?.toIso8601String(),
      };

  static Account fromJson(Map<String, dynamic> json) => Account(
        id: json['id'] as String,
        sites: (json['sites'] as List).map((e) => e.toString()).toList(),
        username: json['username'] as String,
        password: json['password'] as String,
        totp: (json['totp'] ?? '') as String,
        recovery: (json['recovery'] ?? '') as String,
        note: (json['note'] ?? '') as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        updatedAt: DateTime.parse(json['updatedAt'] as String),
        deletedAt: json['deletedAt'] == null
            ? null
            : DateTime.parse(json['deletedAt'] as String),
      );

  String toCsvLine() {
    String esc(String s) => '"${s.replaceAll('"', '""')}"';
    return [
      id,
      sites.join('|'),
      username,
      password,
      totp,
      recovery,
      note,
      fmt(createdAt),
      fmt(updatedAt),
      deletedAt == null ? '' : fmt(deletedAt!),
    ].map(esc).join(',');
  }
}

class AccountAliasSync {
  static List<Account> sync(List<Account> input) {
    final accounts = [...input];
    final parent = <String, String>{};

    for (final site in accounts.expand((a) => a.sites)) {
      parent[site] = site;
    }

    String find(String x) {
      var cur = x;
      while (parent[cur] != cur) {
        cur = parent[cur]!;
      }
      var root = cur;
      cur = x;
      while (parent[cur] != cur) {
        final nxt = parent[cur]!;
        parent[cur] = root;
        cur = nxt;
      }
      return root;
    }

    void union(String a, String b) {
      final pa = find(a);
      final pb = find(b);
      if (pa != pb) parent[pb] = pa;
    }

    for (final a in accounts) {
      if (a.sites.length <= 1) continue;
      for (int i = 1; i < a.sites.length; i++) {
        union(a.sites[0], a.sites[i]);
      }
    }

    final groups = <String, Set<String>>{};
    for (final site in parent.keys) {
      groups.putIfAbsent(find(site), () => <String>{}).add(site);
    }

    return accounts.map((a) {
      if (a.sites.isEmpty) return a;
      final merged = <String>{};
      for (final s in a.sites) {
        final root = find(s);
        merged.addAll(groups[root] ?? {s});
      }
      final list = merged.toList()..sort();
      return a.copyWith(sites: list);
    }).toList(growable: false);
  }
}

class AppState {
  AppState({required this.deviceName, required this.accounts});

  final String deviceName;
  final List<Account> accounts;

  Map<String, dynamic> toJson() => {
        'deviceName': deviceName,
        'accounts': accounts.map((e) => e.toJson()).toList(),
      };

  static AppState fromJson(Map<String, dynamic> map) => AppState(
        deviceName: (map['deviceName'] ?? 'Desktop') as String,
        accounts: ((map['accounts'] ?? []) as List)
            .map((e) => Account.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList(),
      );
}

class LocalStore {
  Future<Directory> appDataDir() async {
    final base = await getApplicationSupportDirectory();
    final dir = Directory('${base.path}/pass-desktop');
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  Future<File> _stateFile() async {
    final dir = await appDataDir();
    return File('${dir.path}/state.json');
  }

  Future<AppState> load() async {
    final f = await _stateFile();
    if (!await f.exists()) {
      final initial =
          AppState(deviceName: Platform.localHostname, accounts: []);
      await save(initial);
      return initial;
    }
    final data = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
    return AppState.fromJson(data);
  }

  Future<void> save(AppState state) async {
    final f = await _stateFile();
    await f.writeAsString(
        const JsonEncoder.withIndent('  ').convert(state.toJson()));
  }

  Future<File> exportCsvString(String csv) async {
    final dir = await appDataDir();
    final ts = DateTime.now().millisecondsSinceEpoch;
    final file = File('${dir.path}/pass-export-$ts.csv');
    await file.writeAsString(csv);
    return file;
  }
}
