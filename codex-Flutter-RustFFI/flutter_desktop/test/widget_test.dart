import 'package:flutter_test/flutter_test.dart';
import 'package:codex_flutter_rustffi/main.dart';

void main() {
  test('fmt uses yy-M-d H:m:s style', () {
    final dt = DateTime(2026, 3, 27, 9, 2, 8);
    expect(fmt(dt), '26-3-27 9:2:8');
  });
}
