import 'dart:async';
import 'dart:convert';
import 'dart:io' show File, Platform;

import 'package:flutter/material.dart';

void main() {
  runApp(const Copilot53DesktopApp());
}

class Copilot53DesktopApp extends StatelessWidget {
  const Copilot53DesktopApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Copilot 53 Flutter',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2563EB)),
        useMaterial3: true,
      ),
      home: const DesktopHomePage(),
    );
  }
}

class DesktopHomePage extends StatefulWidget {
  const DesktopHomePage({super.key});

  @override
  State<DesktopHomePage> createState() => _DesktopHomePageState();
}

class _DesktopHomePageState extends State<DesktopHomePage> {
  final List<PasswordAccount> _accounts = [];
  final List<PasswordAccount> _recycleBin = [];
  final _sitesController = TextEditingController();
  final _deviceController = TextEditingController(text: 'Copilot53Desktop');
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _totpController = TextEditingController();
  final _recoveryController = TextEditingController();
  final _noteController = TextEditingController();
  final _searchController = TextEditingController();
  String _deviceName = 'Copilot53Desktop';
  String? _editingAccountId;
  bool _showRecycleBin = false;
  String _exportInfo = '';
  AccountSort _sort = AccountSort.updatedDesc;

  String get _stateFilePath {
    final home = Platform.environment['HOME'];
    final root = (home == null || home.isEmpty) ? '.' : '$home/.passkey';
    return '$root/copilot-53-flutter-state.json';
  }

  @override
  void initState() {
    super.initState();
    unawaited(_loadState());
  }

  @override
  void dispose() {
    _sitesController.dispose();
    _deviceController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    _totpController.dispose();
    _recoveryController.dispose();
    _noteController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _createDemoData() {
    setState(() {
      _editingAccountId = null;
      _accounts
        ..clear()
        ..addAll([
          PasswordAccount.create(
            sites: ['github.com', 'githubusercontent.com'],
            username: 'alice',
            password: 'Demo#1234',
            totp: 'JBSWY3DPEHPK3PXP',
            recoveryCodes: 'ALICE-RECOVERY-001',
            note: '开发账号',
            deviceName: _deviceName,
          ),
          PasswordAccount.create(
            sites: ['google.com', 'gmail.com'],
            username: 'alice.g',
            password: 'Demo#5678',
            totp: 'GEZDGNBVGY3TQOJQ',
            recoveryCodes: 'ALICE-RECOVERY-002',
            note: '邮箱账号',
            deviceName: _deviceName,
          ),
          PasswordAccount.create(
            sites: ['example.com', 'example.org'],
            username: 'demo-user',
            password: 'Demo#9999',
            totp: '',
            recoveryCodes: '',
            note: '测试数据',
            deviceName: _deviceName,
          ),
        ]);
      _recycleBin.clear();
      _syncAliasDomains();
    });
    _persistState();
  }

  void _saveAccount() {
    final sites = _parseSites(_sitesController.text);
    final username = _usernameController.text.trim();
    final password = _passwordController.text;
    if (sites.isEmpty || username.isEmpty || password.isEmpty) {
      _showMessage('请至少填写站点、用户名、密码');
      return;
    }

    setState(() {
      if (_editingAccountId == null) {
        _accounts.add(
          PasswordAccount.create(
            sites: sites,
            username: username,
            password: password,
            totp: _totpController.text.trim(),
            recoveryCodes: _recoveryController.text.trim(),
            note: _noteController.text.trim(),
            deviceName: _deviceName,
          ),
        );
        _showMessage('已新增账号');
      } else {
        final index = _accounts.indexWhere((item) => item.id == _editingAccountId);
        if (index >= 0) {
          _accounts[index] = _accounts[index].update(
            sites: sites,
            username: username,
            password: password,
            totp: _totpController.text.trim(),
            recoveryCodes: _recoveryController.text.trim(),
            note: _noteController.text.trim(),
            deviceName: _deviceName,
          );
          _showMessage('已更新账号');
        }
      }
      _editingAccountId = null;
      _syncAliasDomains();
    });

    _clearForm();
    _persistState();
  }

  void _startEdit(PasswordAccount account) {
    setState(() {
      _editingAccountId = account.id;
      _sitesController.text = account.sites.join(', ');
      _usernameController.text = account.username;
      _passwordController.text = account.password;
      _totpController.text = account.totp;
      _recoveryController.text = account.recoveryCodes;
      _noteController.text = account.note;
    });
  }

  void _cancelEdit() {
    setState(() => _editingAccountId = null);
    _clearForm();
  }

  void _clearForm() {
    _sitesController.clear();
    _usernameController.clear();
    _passwordController.clear();
    _totpController.clear();
    _recoveryController.clear();
    _noteController.clear();
  }

  void _deleteToRecycle(PasswordAccount item) {
    setState(() {
      _accounts.removeWhere((it) => it.id == item.id);
      _recycleBin.insert(0, item.softDelete(deviceName: _deviceName));
      _clearForm();
    });
    _persistState();
    _showMessage('已移动到回收站');
  }

  void _restoreFromRecycle(PasswordAccount item) {
    setState(() {
      _recycleBin.removeWhere((it) => it.id == item.id);
      _accounts.insert(0, item.restore(deviceName: _deviceName));
      _syncAliasDomains();
    });
    _persistState();
    _showMessage('已恢复账号');
  }

  void _deleteForever(PasswordAccount item) {
    setState(() => _recycleBin.removeWhere((it) => it.id == item.id));
    _persistState();
    _showMessage('已永久删除');
  }

  Future<void> _exportCsv() async {
    final rows = <List<String>>[
      [
        'id',
        'sites',
        'username',
        'password',
        'totp',
        'recoveryCodes',
        'note',
        'createdAt',
        'updatedAt',
        'deletedAt',
        'createdDevice',
        'updatedDevice',
        'deletedDevice',
      ],
      ..._accounts.map((it) => it.toCsvRow()),
      ..._recycleBin.map((it) => it.toCsvRow()),
    ];
    final csv = rows.map((line) => line.map(_escapeCsv).join(',')).join('\n');

    final now = DateTime.now().millisecondsSinceEpoch;
    final home = Platform.environment['HOME'] ?? '.';
    final path = '$home/pass-export-$now.csv';
    final file = File(path);
    await file.writeAsString(csv, encoding: utf8);
    if (!mounted) return;
    setState(() => _exportInfo = '已导出：$path');
    _showMessage('CSV 导出成功');
  }

  Future<void> _loadState() async {
    final file = File(_stateFilePath);
    if (!await file.exists()) return;
    try {
      final content = await file.readAsString();
      final json = jsonDecode(content) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _deviceName = (json['deviceName'] as String?)?.trim().isNotEmpty == true
            ? json['deviceName'] as String
            : _deviceName;
        _deviceController.text = _deviceName;
        _accounts
          ..clear()
          ..addAll(
            (json['accounts'] as List<dynamic>? ?? [])
                .whereType<Map<String, dynamic>>()
                .map(PasswordAccount.fromJson),
          );
        _recycleBin
          ..clear()
          ..addAll(
            (json['recycleBin'] as List<dynamic>? ?? [])
                .whereType<Map<String, dynamic>>()
                .map(PasswordAccount.fromJson),
          );
        _syncAliasDomains();
      });
    } catch (_) {
      if (mounted) {
        _showMessage('读取本地数据失败，已使用空数据启动');
      }
    }
  }

  void _persistState() {
    unawaited(_saveState());
  }

  Future<void> _saveState() async {
    final file = File(_stateFilePath);
    await file.parent.create(recursive: true);
    final payload = {
      'deviceName': _deviceName,
      'accounts': _accounts.map((it) => it.toJson()).toList(),
      'recycleBin': _recycleBin.map((it) => it.toJson()).toList(),
    };
    await file.writeAsString(jsonEncode(payload), encoding: utf8);
  }

  void _syncAliasDomains() {
    if (_accounts.length < 2) return;
    final normalized = _accounts.map((account) => account.sites.toSet()).toList();
    for (var i = 0; i < normalized.length; i++) {
      var merged = {...normalized[i]};
      var changed = false;
      do {
        changed = false;
        for (var j = 0; j < normalized.length; j++) {
          if (merged.intersection(normalized[j]).isNotEmpty) {
            final oldSize = merged.length;
            merged.addAll(normalized[j]);
            if (merged.length != oldSize) changed = true;
          }
        }
      } while (changed);

      for (var j = 0; j < normalized.length; j++) {
        if (merged.intersection(normalized[j]).isNotEmpty) {
          normalized[j] = merged;
        }
      }
    }

    for (var i = 0; i < _accounts.length; i++) {
      final mergedSites = normalized[i].toList()..sort();
      _accounts[i] = _accounts[i].update(
        sites: mergedSites,
        username: _accounts[i].username,
        password: _accounts[i].password,
        totp: _accounts[i].totp,
        recoveryCodes: _accounts[i].recoveryCodes,
        note: _accounts[i].note,
        deviceName: _deviceName,
        touchTimestamp: false,
      );
    }
  }

  List<String> _parseSites(String raw) {
    final dedup = <String>{};
    for (final value in raw.split(',')) {
      final site = value.trim().toLowerCase();
      if (site.isNotEmpty) dedup.add(site);
    }
    return dedup.toList()..sort();
  }

  List<PasswordAccount> _sortedAndFiltered(List<PasswordAccount> source) {
    final query = _searchController.text.trim().toLowerCase();
    final filtered = source.where((item) {
      if (query.isEmpty) return true;
      final haystack = [
        item.sites.join(' '),
        item.username,
        item.note,
        item.password,
        item.totp,
        item.recoveryCodes,
      ].join(' ').toLowerCase();
      return haystack.contains(query);
    }).toList();

    switch (_sort) {
      case AccountSort.updatedDesc:
        filtered.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
        break;
      case AccountSort.createdAsc:
        filtered.sort((a, b) => a.createdAt.compareTo(b.createdAt));
        break;
      case AccountSort.siteAsc:
        filtered.sort((a, b) => a.primarySite.compareTo(b.primarySite));
        break;
    }
    return filtered;
  }

  String _escapeCsv(String value) {
    final escaped = value.replaceAll('"', '""');
    return '"$escaped"';
  }

  void _showMessage(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    final platform = Platform.operatingSystem;

    return Scaffold(
      appBar: AppBar(
        title: const Text('copilot-53-flutter'),
        actions: [
          IconButton(
            key: const Key('showRecycleButton'),
            onPressed: () => setState(() => _showRecycleBin = !_showRecycleBin),
            icon: Icon(_showRecycleBin ? Icons.list_alt : Icons.delete_sweep_outlined),
            tooltip: _showRecycleBin ? '查看账号列表' : '回收站',
          ),
          IconButton(
            key: const Key('exportCsvButton'),
            onPressed: _exportCsv,
            icon: const Icon(Icons.download),
            tooltip: '导出 CSV',
          ),
          IconButton(
            key: const Key('createDemoButton'),
            onPressed: _createDemoData,
            icon: const Icon(Icons.auto_awesome),
            tooltip: '生成演示数据',
          ),
        ],
      ),
      body: Row(
        children: [
          SizedBox(
            width: 320,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('运行平台：$platform', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 12),
                    TextField(
                      key: const Key('deviceField'),
                      decoration: const InputDecoration(
                        labelText: '设备名',
                        border: OutlineInputBorder(),
                      ),
                      controller: _deviceController,
                      onSubmitted: (value) {
                        setState(() {
                          _deviceName = value.trim().isEmpty ? _deviceName : value.trim();
                          _deviceController.text = _deviceName;
                        });
                        _persistState();
                      },
                    ),
                    const SizedBox(height: 16),
                    Text(_editingAccountId == null ? '新增账号' : '编辑账号', style: const TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    TextField(
                      key: const Key('sitesField'),
                      controller: _sitesController,
                      decoration: const InputDecoration(
                        labelText: '站点（逗号分隔）',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      key: const Key('usernameField'),
                      controller: _usernameController,
                      decoration: const InputDecoration(
                        labelText: '用户名',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      key: const Key('passwordField'),
                      controller: _passwordController,
                      decoration: const InputDecoration(
                        labelText: '密码',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      key: const Key('totpField'),
                      controller: _totpController,
                      decoration: const InputDecoration(
                        labelText: 'TOTP',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      key: const Key('recoveryField'),
                      controller: _recoveryController,
                      decoration: const InputDecoration(
                        labelText: '恢复码',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      key: const Key('noteField'),
                      controller: _noteController,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText: '备注',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    FilledButton.icon(
                      key: const Key('saveAccountButton'),
                      onPressed: _saveAccount,
                      icon: Icon(_editingAccountId == null ? Icons.add : Icons.save),
                      label: Text(_editingAccountId == null ? '保存账号' : '更新账号'),
                    ),
                    if (_editingAccountId != null)
                      TextButton(
                        key: const Key('cancelEditButton'),
                        onPressed: _cancelEdit,
                        child: const Text('取消编辑'),
                      ),
                    const SizedBox(height: 8),
                    TextField(
                      key: const Key('searchField'),
                      controller: _searchController,
                      decoration: const InputDecoration(
                        labelText: '搜索（站点 / 用户名 / 备注 / 密码 / TOTP）',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(Icons.search),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<AccountSort>(
                      key: const Key('sortSelect'),
                      value: _sort,
                      items: const [
                        DropdownMenuItem(value: AccountSort.updatedDesc, child: Text('按更新时间（新→旧）')),
                        DropdownMenuItem(value: AccountSort.createdAsc, child: Text('按创建时间（旧→新）')),
                        DropdownMenuItem(value: AccountSort.siteAsc, child: Text('按站点 A→Z')),
                      ],
                      onChanged: (value) {
                        if (value == null) return;
                        setState(() => _sort = value);
                      },
                      decoration: const InputDecoration(
                        labelText: '排序',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const VerticalDivider(width: 1),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: _showRecycleBin
                  ? _buildRecycleList()
                  : _buildActiveList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActiveList() {
    final items = _sortedAndFiltered(_accounts);
    if (items.isEmpty) {
      return const Center(child: Text('暂无数据，点击右上角“魔法棒”可生成演示数据。'));
    }
    return ListView.separated(
      itemBuilder: (context, index) {
        final item = items[index];
        return ListTile(
          title: Text('${item.primarySite} · ${item.username}'),
          subtitle: Text(
            '站点: ${item.sites.join(', ')}\n'
            '密码: ${item.password}\n'
            'TOTP: ${item.totp}\n'
            '恢复码: ${item.recoveryCodes}\n'
            '备注: ${item.note}\n'
            '创建: ${formatTimestamp(item.createdAt)} (${item.createdDevice})\n'
            '更新: ${formatTimestamp(item.updatedAt)} (${item.updatedDevice})',
          ),
          isThreeLine: true,
          trailing: Wrap(
            spacing: 4,
            children: [
              IconButton(
                icon: const Icon(Icons.edit_outlined),
                tooltip: '编辑账号',
                onPressed: () => _startEdit(item),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline),
                tooltip: '删除到回收站',
                onPressed: () => _deleteToRecycle(item),
              ),
            ],
          ),
        );
      },
      separatorBuilder: (context, index) => const Divider(),
      itemCount: items.length,
    );
  }

  Widget _buildRecycleList() {
    final items = _sortedAndFiltered(_recycleBin);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('回收站（${items.length}）', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        if (_exportInfo.isNotEmpty) Text(_exportInfo, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 8),
        Expanded(
          child: items.isEmpty
              ? const Center(child: Text('回收站为空'))
                  : ListView.separated(
                      itemBuilder: (context, index) {
                        final item = items[index];
                        return ListTile(
                          title: Text('${item.primarySite} · ${item.username}'),
                          subtitle: Text(
                            '站点: ${item.sites.join(', ')}\n'
                            '备注: ${item.note}\n'
                            '删除于: ${item.deletedAt == null ? '-' : formatTimestamp(item.deletedAt!)}'
                            ' (${item.deletedDevice ?? '-'})',
                          ),
                          isThreeLine: true,
                          trailing: Wrap(
                            spacing: 4,
                            children: [
                              IconButton(
                                icon: const Icon(Icons.restore_from_trash_outlined),
                                tooltip: '恢复账号',
                                onPressed: () => _restoreFromRecycle(item),
                              ),
                              IconButton(
                                icon: const Icon(Icons.delete_forever_outlined),
                                tooltip: '永久删除',
                                onPressed: () => _deleteForever(item),
                              ),
                            ],
                          ),
                        );
                      },
                      separatorBuilder: (context, index) => const Divider(),
                      itemCount: items.length,
                    ),
        ),
      ],
    );
  }
}

String formatTimestamp(DateTime value) {
  final y = (value.year % 100).toString().padLeft(2, '0');
  return '$y-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}';
}

enum AccountSort { updatedDesc, createdAsc, siteAsc }

class PasswordAccount {
  PasswordAccount({
    required this.id,
    required this.sites,
    required this.username,
    required this.password,
    required this.totp,
    required this.recoveryCodes,
    required this.note,
    required this.createdAt,
    required this.updatedAt,
    required this.createdDevice,
    required this.updatedDevice,
    this.deletedAt,
    this.deletedDevice,
  });

  factory PasswordAccount.create({
    required List<String> sites,
    required String username,
    required String password,
    required String totp,
    required String recoveryCodes,
    required String note,
    required String deviceName,
  }) {
    final now = DateTime.now();
    return PasswordAccount(
      id: '${now.microsecondsSinceEpoch}-${_seed++}',
      sites: sites,
      username: username,
      password: password,
      totp: totp,
      recoveryCodes: recoveryCodes,
      note: note,
      createdAt: now,
      updatedAt: now,
      createdDevice: deviceName,
      updatedDevice: deviceName,
    );
  }

  factory PasswordAccount.fromJson(Map<String, dynamic> json) {
    return PasswordAccount(
      id: json['id'] as String? ?? '',
      sites: (json['sites'] as List<dynamic>? ?? []).whereType<String>().toList(),
      username: json['username'] as String? ?? '',
      password: json['password'] as String? ?? '',
      totp: json['totp'] as String? ?? '',
      recoveryCodes: json['recoveryCodes'] as String? ?? '',
      note: json['note'] as String? ?? '',
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      deletedAt: (json['deletedAt'] as String?) == null ? null : DateTime.parse(json['deletedAt'] as String),
      createdDevice: json['createdDevice'] as String? ?? '',
      updatedDevice: json['updatedDevice'] as String? ?? '',
      deletedDevice: json['deletedDevice'] as String?,
    );
  }

  final String id;
  final List<String> sites;
  final String username;
  final String password;
  final String totp;
  final String recoveryCodes;
  final String note;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? deletedAt;
  final String createdDevice;
  final String updatedDevice;
  final String? deletedDevice;

  String get primarySite => sites.isEmpty ? '-' : sites.first;

  PasswordAccount update({
    required List<String> sites,
    required String username,
    required String password,
    required String totp,
    required String recoveryCodes,
    required String note,
    required String deviceName,
    bool touchTimestamp = true,
  }) {
    final now = DateTime.now();
    return PasswordAccount(
      id: id,
      sites: sites,
      username: username,
      password: password,
      totp: totp,
      recoveryCodes: recoveryCodes,
      note: note,
      createdAt: createdAt,
      updatedAt: touchTimestamp ? now : updatedAt,
      deletedAt: deletedAt,
      createdDevice: createdDevice,
      updatedDevice: touchTimestamp ? deviceName : updatedDevice,
      deletedDevice: deletedDevice,
    );
  }

  PasswordAccount softDelete({required String deviceName}) {
    final now = DateTime.now();
    return PasswordAccount(
      id: id,
      sites: sites,
      username: username,
      password: password,
      totp: totp,
      recoveryCodes: recoveryCodes,
      note: note,
      createdAt: createdAt,
      updatedAt: now,
      deletedAt: now,
      createdDevice: createdDevice,
      updatedDevice: deviceName,
      deletedDevice: deviceName,
    );
  }

  PasswordAccount restore({required String deviceName}) {
    final now = DateTime.now();
    return PasswordAccount(
      id: id,
      sites: sites,
      username: username,
      password: password,
      totp: totp,
      recoveryCodes: recoveryCodes,
      note: note,
      createdAt: createdAt,
      updatedAt: now,
      deletedAt: null,
      createdDevice: createdDevice,
      updatedDevice: deviceName,
      deletedDevice: null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'sites': sites,
      'username': username,
      'password': password,
      'totp': totp,
      'recoveryCodes': recoveryCodes,
      'note': note,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
      'deletedAt': deletedAt?.toIso8601String(),
      'createdDevice': createdDevice,
      'updatedDevice': updatedDevice,
      'deletedDevice': deletedDevice,
    };
  }

  List<String> toCsvRow() {
    return [
      id,
      sites.join('|'),
      username,
      password,
      totp,
      recoveryCodes,
      note,
      formatTimestamp(createdAt),
      formatTimestamp(updatedAt),
      deletedAt == null ? '' : formatTimestamp(deletedAt!),
      createdDevice,
      updatedDevice,
      deletedDevice ?? '',
    ];
  }
}

int _seed = 1;
