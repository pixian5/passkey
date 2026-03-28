import 'package:copilot_53_flutter/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('桌面应用可以正常渲染标题', (WidgetTester tester) async {
    await tester.pumpWidget(const Copilot53DesktopApp());

    expect(find.text('copilot-53-flutter'), findsOneWidget);
    expect(find.textContaining('运行平台：'), findsOneWidget);
  });

  testWidgets('支持新增、编辑并移动到回收站', (WidgetTester tester) async {
    await tester.pumpWidget(const Copilot53DesktopApp());

    await tester.enterText(find.byKey(const Key('sitesField')), 'github.com, githubusercontent.com');
    await tester.enterText(find.byKey(const Key('usernameField')), 'alice');
    await tester.enterText(find.byKey(const Key('passwordField')), 'Demo#1234');
    await tester.enterText(find.byKey(const Key('totpField')), 'JBSWY3DPEHPK3PXP');
    await tester.enterText(find.byKey(const Key('recoveryField')), 'CODE-001');
    await tester.enterText(find.byKey(const Key('noteField')), '开发账号');
    await tester.tap(find.byKey(const Key('saveAccountButton')));
    await tester.pumpAndSettle();

    expect(find.textContaining('github.com · alice'), findsOneWidget);
    expect(find.byIcon(Icons.edit_outlined), findsOneWidget);

    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('noteField')), '更新后备注');
    await tester.tap(find.byKey(const Key('saveAccountButton')));
    await tester.pumpAndSettle();

    expect(find.textContaining('更新后备注'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.delete_outline));
    await tester.pumpAndSettle();

    expect(find.text('暂无数据，点击右上角“魔法棒”可生成演示数据。'), findsOneWidget);

    await tester.tap(find.byKey(const Key('showRecycleButton')));
    await tester.pumpAndSettle();
    expect(find.textContaining('回收站（1）'), findsOneWidget);
    expect(find.byIcon(Icons.restore_from_trash_outlined), findsOneWidget);
  });

  test('时间格式符合 yy-M-d H:m:s', () {
    final value = DateTime(2026, 3, 14, 9, 2, 8);
    expect(formatTimestamp(value), '26-3-14 9:2:8');
  });
}
