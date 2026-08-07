import 'package:dio/dio.dart';
import 'dart:convert';
import '../models/models.dart';

class SyncService {
  final Dio _dio = Dio();

  Future<void> syncWithServer(
    SyncConfig config,
    List<PasswordAccount> localAccounts,
  ) async {
    if (config.backendType == 'webdav') {
      await _syncWebDAV(config, localAccounts);
    } else if (config.backendType == 'self-hosted') {
      await _syncSelfHosted(config, localAccounts);
    } else {
      throw Exception('Unsupported sync backend: ${config.backendType}');
    }
  }

  Future<void> _syncWebDAV(
    SyncConfig config,
    List<PasswordAccount> localAccounts,
  ) async {
    final bundle = {
      'version': '0.1.0',
      'device_id': 'flutter-device',
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'accounts': localAccounts.map((a) => a.toJson()).toList(),
    };

    final options = Options(
      headers: {
        'Content-Type': 'application/json',
        if (config.username != null && config.password != null)
          'Authorization':
              'Basic ${base64Encode(utf8.encode('${config.username}:${config.password}'))}',
      },
    );

    await _dio.put(
      config.serverUrl,
      data: jsonEncode(bundle),
      options: options,
    );
  }

  Future<List<PasswordAccount>> _syncSelfHosted(
    SyncConfig config,
    List<PasswordAccount> localAccounts,
  ) async {
    final bundle = {
      'version': '0.1.0',
      'device_id': 'flutter-device',
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'accounts': localAccounts.map((a) => a.toJson()).toList(),
    };

    final options = Options(
      headers: {
        'Content-Type': 'application/json',
        if (config.bearerToken != null)
          'Authorization': 'Bearer ${config.bearerToken}',
      },
    );

    final response = await _dio.post(
      '${config.serverUrl}/sync',
      data: jsonEncode(bundle),
      options: options,
    );

    final remoteBundle = response.data as Map<String, dynamic>;
    final remoteAccounts = (remoteBundle['accounts'] as List)
        .map((json) => PasswordAccount.fromJson(json as Map<String, dynamic>))
        .toList();

    return remoteAccounts;
  }
}
