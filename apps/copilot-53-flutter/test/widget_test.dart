import 'package:copilot_53_flutter/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('桌面应用可以正常渲染标题', (WidgetTester tester) async {
    await tester.pumpWidget(const Copilot53DesktopApp());

    expect(find.text('copilot-53-flutter'), findsOneWidget);
    expect(find.textContaining('运行平台：'), findsOneWidget);
  });
}
