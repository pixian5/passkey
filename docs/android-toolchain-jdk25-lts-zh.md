# Android 工具链 JDK 25 LTS 迁移记录

## 当前组合

- Gradle Wrapper: 9.7.0
- Android Gradle Plugin: 9.3.1
- Kotlin: 使用 AGP 9 的内置 Kotlin 支持
- Gradle 运行时 JDK: 25 LTS（本机 25.0.3）
- Android `compileSdk` / `targetSdk`: 36
- Android SDK: `/Users/x/Library/Android/sdk`

Gradle 官方兼容表要求使用 JDK 25 运行 Gradle 时至少使用 Gradle 9.1.0，因此项目采用 9.7.0。AGP 9.3.1 要求 Gradle 至少 9.5.0，并且已经内置 Kotlin；模块不再应用 `org.jetbrains.kotlin.android` 插件。

## 本机验证命令

```bash
cd apps/android_credential_provider
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-25.jdk/Contents/Home \
ANDROID_HOME=/Users/x/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/x/Library/Android/sdk \
./gradlew --no-daemon testDebugUnitTest :app:assembleDebug
```

验证结果：Android 单元测试和 Debug APK 构建均通过。

## 诊断边界

错误中的 `25.0.3` 或 `26.0.2` 若出现在 `JavaVersion.parse` 堆栈中，表示 Gradle 启动时使用的 JDK 版本，不是 Android SDK Build Tools 版本。JDK 25 LTS 应使用 `25.0.3`；`build-tools;26.0.2` 可以单独安装，但不能修复 Java 版本解析错误。

本机命令行工具仍可能提示 SDK XML v4，而当前工具只识别到 v3；这次没有阻断构建，后续应将 Android command-line tools 与 SDK 元数据版本保持一致。
