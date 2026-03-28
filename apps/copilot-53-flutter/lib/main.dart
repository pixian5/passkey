import 'dart:io' show Platform;

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
  final List<CredentialItem> _items = [];
  final _siteController = TextEditingController();
  final _deviceController = TextEditingController(text: 'Copilot53Desktop');
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _noteController = TextEditingController();
  String _deviceName = 'Copilot53Desktop';

  @override
  void dispose() {
    _siteController.dispose();
    _deviceController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  void _createDemoData() {
    setState(() {
      _items
        ..clear()
        ..addAll([
          CredentialItem(
            site: 'github.com',
            username: 'alice',
            password: 'Demo#1234',
            note: '开发账号',
          ),
          CredentialItem(
            site: 'google.com',
            username: 'alice.g',
            password: 'Demo#5678',
            note: '邮箱账号',
          ),
          CredentialItem(
            site: 'example.com',
            username: 'demo-user',
            password: 'Demo#9999',
            note: '测试数据',
          ),
        ]);
    });
  }

  void _addItem() {
    final site = _siteController.text.trim();
    final username = _usernameController.text.trim();
    final password = _passwordController.text;
    if (site.isEmpty || username.isEmpty || password.isEmpty) {
      _showMessage('请至少填写站点、用户名、密码');
      return;
    }

    setState(() {
      _items.add(
        CredentialItem(
          site: site,
          username: username,
          password: password,
          note: _noteController.text.trim(),
        ),
      );
    });

    _siteController.clear();
    _usernameController.clear();
    _passwordController.clear();
    _noteController.clear();
    _showMessage('已新增账号');
  }

  void _deleteItem(CredentialItem item) {
    setState(() => _items.remove(item));
    _showMessage('已删除账号');
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('运行平台：$platform', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 12),
                  TextField(
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
                    },
                  ),
                  const SizedBox(height: 16),
                  const Text('新增账号', style: TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _siteController,
                    decoration: const InputDecoration(
                      labelText: '站点',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _usernameController,
                    decoration: const InputDecoration(
                      labelText: '用户名',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _passwordController,
                    decoration: const InputDecoration(
                      labelText: '密码',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _noteController,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      labelText: '备注',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 10),
                  FilledButton.icon(
                    onPressed: _addItem,
                    icon: const Icon(Icons.add),
                    label: const Text('保存账号'),
                  ),
                ],
              ),
            ),
          ),
          const VerticalDivider(width: 1),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: _items.isEmpty
                  ? const Center(child: Text('暂无数据，点击右上角“魔法棒”可生成演示数据。'))
                  : ListView.separated(
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        return ListTile(
                          title: Text('${item.site} · ${item.username}'),
                          subtitle: Text('密码: ${item.password}\n备注: ${item.note}'),
                          isThreeLine: true,
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => _deleteItem(item),
                          ),
                        );
                      },
                      separatorBuilder: (context, index) => const Divider(),
                      itemCount: _items.length,
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class CredentialItem {
  CredentialItem({
    required this.site,
    required this.username,
    required this.password,
    required this.note,
  });

  final String site;
  final String username;
  final String password;
  final String note;
}
