import 'package:copilot_claude_flutter/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('桌面应用可以正常渲染标题', (WidgetTester tester) async {
    await tester.pumpWidget(const CopilotClaudeDesktopApp());

    expect(find.text('copilot-Claude-flutter'), findsOneWidget);
    expect(find.textContaining('运行平台：'), findsOneWidget);
  });
}
