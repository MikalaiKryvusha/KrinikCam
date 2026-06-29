# Bug 06 — «Build Error» в статус-баре VS Code (Gradle toolchain Java 17)

> Статус: **✅ ИСПРАВЛЕН** (2026-06-28). Файл фикса: `.vscode/settings.json`.
> Симптом нашёл Криник: внизу в статус-баре VS Code висит `Build Error` — «немного нервирует».

---

## Симптом

В статус-баре VS Code постоянно `Build Error`, в логах окна Gradle:

```
Could not create task ':app:compileDebugAndroidTestJavaWithJavac'.
> ... property 'javaCompiler'.
   > Cannot find a Java installation on your machine matching this tasks
     requirements: {languageVersion=17, ...} for MAC_OS on aarch64.
      > No locally installed toolchains match and toolchain download
        repositories have not been configured.
```

CLI-сборка (`tools/build.mjs`) при этом проходит без ошибок.

## Root cause

Проект во всех модулях требует **toolchain Java 17** (`jvmToolchain(17)` +
`sourceCompatibility = VERSION_17`). На машине через `/usr/libexec/java_home`
доступна только **Java 25** (Temurin); Java 17 живёт внутри Android Studio JBR
(`/Applications/Android Studio.app/Contents/jbr/Contents/Home` = 17.0.6).

- **CLI работает**: `tools/build.mjs` ставит `JAVA_HOME` на JBR → Gradle-демон
  крутится на Java 17 → требование toolchain удовлетворено самим рантаймом
  (Gradle берёт текущий JVM, если он подходит).
- **VS Code падает**: Gradle/Java-расширение запускает Gradle на своей встроенной
  Java 21 (`~/.vscode/extensions/redhat.java-*/jre/21...`), а отдельный JDK 17 для
  toolchain нигде не находит (auto-detect не сканирует путь Android Studio,
  auto-download не настроен) → таск androidTest не конфигурируется → `Build Error`.

## Фикс

### Попытка 1 (не сработала): `.vscode/settings.json`

```jsonc
"java.import.gradle.java.home": "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
"java.jdt.ls.java.home":       "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
```

После Reload Window ошибка осталась: лог показал свежую запись с тем же
`NoToolchainAvailableException`, а Gradle-демон IDE по-прежнему крутился на
встроенной Java 21 (`~/.vscode/extensions/redhat.java-*/jre/21.0.11`). **Buildship
внутри redhat.java игнорирует `java.import.gradle.java.home` и сам выбирает JVM.**
Настройку оставили (безвредна), но проблему она не решает.

### Попытка 2 (сработала ✅): user-level `~/.gradle/gradle.properties`

```properties
org.gradle.java.installations.paths=/Applications/Android Studio.app/Contents/jbr/Contents/Home
```

Не пытаемся менять JVM демона, а делаем JDK 17 **видимым для авто-детекта
toolchain** у любого Gradle на машине. Тогда даже демон на Java 21 находит JBR
как toolchain-кандидат и удовлетворяет `languageVersion=17` без download.
User-level файл → применяется к IDE + CLI, **не уезжает в git/CI** (там путь к
JBR может не существовать; машинно-специфичной конфигурации не место в репо).

## Проверка

- `JAVA_HOME=<JBR-17> ./gradlew :app:compileDebugAndroidTestJavaWithJavac --dry-run`
  → BUILD SUCCESSFUL (тривиально — демон сам на 17).
- **Ключевая проверка** — воспроизведено условие IDE: тот же таск с
  `JAVA_HOME=<redhat jre 21> ./gradlew ... --dry-run --no-daemon` ПОСЛЕ создания
  `~/.gradle/gradle.properties` → **BUILD SUCCESSFUL**. Доказывает: на Java 21
  toolchain 17 теперь находится через `installations.paths`. ✅
- Устаревший Java-21 демон IDE убит (`kill`), чтобы свежий поднялся с новым
  конфигом. После Reload Window в VS Code лог новой сессии (`20:26`) прошёл
  импорт Gradle БЕЗ ошибки toolchain, и **`Build Error` в статус-баре исчез —
  подтверждено Криником (2026-06-28).** ✅

## Уроки

1. `jvmToolchain(N)` требует именно JDK версии N (или auto-download). Если в IDE
   Gradle крутится на другом JVM и нужного JDK нет в auto-detect путях — конфиг
   валится, хотя CLI с правильным `JAVA_HOME` работает.
2. Машинно-специфичный путь к JBR держим в `.vscode/settings.json` (IDE-only),
   а не в общем `gradle.properties` (его читают и CLI, и CI).

---

## Исходная заметка Криника

> Может не критично, а может и критично — стоит проверить. В VS Code внизу на
> панели состояния висят предупреждения и Build Error — немного нервирует.
> Если не критично — ничего не делаем. Если важное падает — подфиксить для
> порядка, но много усилий не тратим.


Такие там логи в этом окне:
[info] [gradle-server] Gradle Server started, listening on 49810
[info] Gradle client connected to server
[info] Java Home: /Users/kryvusha/.vscode/extensions/redhat.java-1.55.0-darwin-arm64/jre/21.0.11-macosx-aarch64
[info] JVM Args: -XX:MaxMetaspaceSize=512m,--add-opens=java.base/java.util=ALL-UNNAMED,--add-opens=java.base/java.lang=ALL-UNNAMED,--add-opens=java.base/java.lang.invoke=ALL-UNNAMED,--add-opens=java.prefs/java.util.prefs=ALL-UNNAMED,--add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED,--add-exports=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED,--add-opens=java.base/java.nio.charset=ALL-UNNAMED,--add-opens=java.base/java.net=ALL-UNNAMED,--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED,-Xmx4g,-Dfile.encoding=UTF-8,-Duser.country=GB,-Duser.language=en,-Duser.variant
[info] Gradle User Home: /Users/kryvusha/.gradle
[info] Gradle Version: 8.10
[error] FAILURE: Build failed with an exception.

* What went wrong:
Could not create task ':app:compileDebugAndroidTestJavaWithJavac'.
> Failed to calculate the value of task ':app:compileDebugAndroidTestJavaWithJavac' property 'javaCompiler'.
   > Cannot find a Java installation on your machine matching this tasks requirements: {languageVersion=17, vendor=any vendor, implementation=vendor-specific} for MAC_OS on aarch64.
      > No locally installed toolchains match and toolchain download repositories have not been configured.

* Try:
> Learn more about toolchain auto-detection at https://docs.gradle.org/8.10/userguide/toolchains.html#sec:auto_detection.
> Learn more about toolchain repositories at https://docs.gradle.org/8.10/userguide/toolchains.html#sub:download_repositories.
> Run with --stacktrace option to get the stack trace.
> Run with --info or --debug option to get more log output.
> Run with --scan to get full insights.
> Get more help at https://help.gradle.org.

CONFIGURE FAILED in 1s
[error] [gradle-server] The supplied build action failed with an exception.
[error] Error getting build for /Users/kryvusha/ai_sandbox/KrinikCam: The supplied build action failed with an exception.
[info] Java Home: /Users/kryvusha/.vscode/extensions/redhat.java-1.55.0-darwin-arm64/jre/21.0.11-macosx-aarch64
[info] JVM Args: -XX:MaxMetaspaceSize=512m,--add-opens=java.base/java.util=ALL-UNNAMED,--add-opens=java.base/java.lang=ALL-UNNAMED,--add-opens=java.base/java.lang.invoke=ALL-UNNAMED,--add-opens=java.prefs/java.util.prefs=ALL-UNNAMED,--add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED,--add-exports=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED,--add-opens=java.base/java.nio.charset=ALL-UNNAMED,--add-opens=java.base/java.net=ALL-UNNAMED,--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED,-Xmx4g,-Dfile.encoding=UTF-8,-Duser.country=GB,-Duser.language=en,-Duser.variant
[info] Gradle User Home: /Users/kryvusha/.gradle
[info] Gradle Version: 8.10
[error] FAILURE: Build failed with an exception.

* What went wrong:
Could not create task ':app:compileDebugAndroidTestJavaWithJavac'.
> Failed to calculate the value of task ':app:compileDebugAndroidTestJavaWithJavac' property 'javaCompiler'.
   > Cannot find a Java installation on your machine matching this tasks requirements: {languageVersion=17, vendor=any vendor, implementation=vendor-specific} for MAC_OS on aarch64.
      > No locally installed toolchains match and toolchain download repositories have not been configured.

* Try:
> Learn more about toolchain auto-detection at https://docs.gradle.org/8.10/userguide/toolchains.html#sec:auto_detection.
> Learn more about toolchain repositories at https://docs.gradle.org/8.10/userguide/toolchains.html#sub:download_repositories.
> Run with --stacktrace option to get the stack trace.
> Run with --info or --debug option to get more log output.
> Run with --scan to get full insights.
> Get more help at https://help.gradle.org.

CONFIGURE FAILED in 827ms
[error] [gradle-server] The supplied build action failed with an exception.
[error] Error getting build for /Users/kryvusha/ai_sandbox/KrinikCam: The supplied build action failed with an exception.
[info] Found 0 tasks
[info] Java Home: /Users/kryvusha/.vscode/extensions/redhat.java-1.55.0-darwin-arm64/jre/21.0.11-macosx-aarch64
[info] JVM Args: -XX:MaxMetaspaceSize=512m,--add-opens=java.base/java.util=ALL-UNNAMED,--add-opens=java.base/java.lang=ALL-UNNAMED,--add-opens=java.base/java.lang.invoke=ALL-UNNAMED,--add-opens=java.prefs/java.util.prefs=ALL-UNNAMED,--add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED,--add-exports=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED,--add-opens=java.base/java.nio.charset=ALL-UNNAMED,--add-opens=java.base/java.net=ALL-UNNAMED,--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED,-Xmx4g,-Dfile.encoding=UTF-8,-Duser.country=GB,-Duser.language=en,-Duser.variant
[info] Gradle User Home: /Users/kryvusha/.gradle
[info] Gradle Version: 8.10
[error] FAILURE: Build failed with an exception.

* What went wrong:
Could not create task ':app:compileDebugAndroidTestJavaWithJavac'.
> Failed to calculate the value of task ':app:compileDebugAndroidTestJavaWithJavac' property 'javaCompiler'.
   > Cannot find a Java installation on your machine matching this tasks requirements: {languageVersion=17, vendor=any vendor, implementation=vendor-specific} for MAC_OS on aarch64.
      > No locally installed toolchains match and toolchain download repositories have not been configured.

* Try:
> Learn more about toolchain auto-detection at https://docs.gradle.org/8.10/userguide/toolchains.html#sec:auto_detection.
> Learn more about toolchain repositories at https://docs.gradle.org/8.10/userguide/toolchains.html#sub:download_repositories.
> Run with --stacktrace option to get the stack trace.
> Run with --info or --debug option to get more log output.
> Run with --scan to get full insights.
> Get more help at https://help.gradle.org.

CONFIGURE FAILED in 375ms
[error] [gradle-server] The supplied build action failed with an exception.
[error] Error getting build for /Users/kryvusha/ai_sandbox/KrinikCam: The supplied build action failed with an exception.
[info] Found 0 tasks
[info] Build file opened: /Users/kryvusha/ai_sandbox/KrinikCam/app/build.gradle.kts
[info] Build file opened: /Users/kryvusha/ai_sandbox/KrinikCam/app/build.gradle.kts
[info] Build file opened: /Users/kryvusha/ai_sandbox/KrinikCam/app/build.gradle.kts
[info] Build file opened: /Users/kryvusha/ai_sandbox/KrinikCam/app/build.gradle.kts