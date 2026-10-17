# Test run report — KCAM release without the developer menu · R8 · .env signing

**Created:** 2026-10-17 20:45 +03:00 · **Run by:** the agent (executor R, Claude Opus 5.5) ·
**Version/build:** 0.8 (74) — debug `com.kriniks.kcam.debug` (BUILD_TIME 2026-10-17 20:34) and release
`com.kriniks.kcam` (BUILD_TIME 2026-10-17 20:35), both from the working tree of 2026-10-17

## 1. Work

The owner's word of 2026-10-17: «в .env заведите ключи для двух сборок: Debug KCAM; KCAM — это будет релизная
сборка без дебаг меню и отладочных инструментов и в R8». Under test: (a) the release has no Developer menu
and no debug tools — `NavGraph.kt` registers the `developer` route and the long-press only in DEBUG,
`DevSettings.kt` reads `false` in release, `MainScreen.kt` hides «Виртуальная камера (отладка)» from the source
picker in release; (b) release is built with R8 (`isMinifyEnabled`, `isShrinkResources`) and still works;
(c) both builds are signed with the `.env` keys (`app/build.gradle.kts` → `signingFrom`). No case set exists;
the basis is the task list above.

## 2. Contour

Windows 11 dev machine, JDK `C:\Android\jdk-17`, SDK `C:\Android\Sdk`, Gradle 8.10 / AGP 8.7.3. Device: Headwolf
Titan 1 (serial DHF8256GB25442874, Android 14+, landscape 2560×1600), USB, shared test tablet; no UVC webcam
attached during the run — only the built-in cameras (id 0, id 1). Data state: debug — the owner's restored data
(4 scenes, 2 stream profiles, 3 encoder profiles, dev toggles «Виртуальная камера» and «Стрим в файл» ON);
release — fresh install, empty data. REAL WORLD: the owner's KCAM release will run with a UVC webcam; the UVC
(serenegiant/jiangdg) frame path was NOT exercised in this run — only its USB monitor started.

## 3. Runs

| # | Moment | Command | Exit / outcome |
|---|---|---|---|
| 1 | 2026-10-17 20:34:39 +03:00 | `node tools/build.mjs --no-ui` | exit 0 · debug APK in 53 s |
| 2 | 2026-10-17 20:35:32 +03:00 | `node tools/build.mjs --no-ui --release` | exit 0 · release APK (R8) in 2 min 58 s, 11.2 MB vs 73.5 MB debug |
| 3 | 2026-10-17 20:35 +03:00 | `C:/Android/Sdk/build-tools/34.0.0/apksigner.bat verify --print-certs app/build/outputs/apk/debug/app-debug.apk` | CN=Debug KCAM, SHA-256 051b1431…bf0d |
| 4 | 2026-10-17 20:38 +03:00 | `C:/Android/Sdk/build-tools/34.0.0/apksigner.bat verify --print-certs app/build/outputs/apk/release/app-release.apk` | CN=KCAM, SHA-256 e05ab587…c89d |
| 5 | 2026-10-17 20:35 +03:00 | `MSYS_NO_PATHCONV=1 adb exec-out run-as com.kriniks.kcam.debug tar -cf - -C /data/data/com.kriniks.kcam.debug . > kcam_debug_data_2.tar` | backup 544 KB, lists databases/, files/datastore/, shared_prefs/ |
| 6 | 2026-10-17 20:36:14 +03:00 | `adb install -r app/build/outputs/apk/debug/app-debug.apk` | INSTALL_FAILED_UPDATE_INCOMPATIBLE (expected: machine key → .env key) |
| 7 | 2026-10-17 20:36:25 +03:00 | `adb uninstall com.kriniks.kcam.debug` → `adb install app/build/outputs/apk/debug/app-debug.apk` → `adb push kcam_debug_data_2.tar /data/local/tmp/kcam_restore.tar` → `adb shell run-as com.kriniks.kcam.debug tar -xf /data/local/tmp/kcam_restore.tar -C /data/data/com.kriniks.kcam.debug` → `adb shell rm /data/local/tmp/kcam_restore.tar` | all Success, restore exit 0, files owned by the new uid, before first launch |
| 8 | 2026-10-17 20:36:41 +03:00 | `adb shell am start -n com.kriniks.kcam.debug/com.kriniks.kcam.MainActivity` + `node tools/ui.mjs allow --once` + `node tools/ui.mjs tap "Сцены"` | preview live; Scenes lists the owner's 4 scenes |
| 9 | 2026-10-17 20:38:26 +03:00 | `adb shell input swipe 307 1006 307 1006 2500` (debug, Settings → О приложении → «KrinikCam») | «Для разработчиков» opened |
| 10 | 2026-10-17 20:39:02 +03:00 | `adb install app/build/outputs/apk/release/app-release.apk` + `adb shell am start -n com.kriniks.kcam/com.kriniks.kcam.MainActivity` + `node tools/ui.mjs allow --once` | Success; app in focus, flags without DEBUGGABLE |
| 11 | 2026-10-17 20:40 +03:00 | `node tools/ui.mjs tap "Слои"` → `tap "Настройки"` → `tap "Основная камера"` → `tap "Готово"` | live preview from the built-in camera |
| 12 | 2026-10-17 20:41:38 +03:00 | `adb shell input swipe 307 1006 307 1006 2500` (release, Settings → О приложении → «KrinikCam») | ordinary «О проекте» dialog; no Developer screen |
| 13 | 2026-10-17 20:41 +03:00 | `adb shell dumpsys activity broadcasts` | release registers only USB_DEVICE_ATTACHED/DETACHED + serenegiant USB_PERMISSION |
| 14 | 2026-10-17 20:42:33 +03:00 | `node tools/ui.mjs kill release` + `node tools/ui.mjs start debug` + `adb logcat -b crash -d` | debug in foreground, crash buffer 0 lines |

(adb = `C:/Android/Sdk/platform-tools/adb.exe -s DHF8256GB25442874`; the harness got `ADB_DEVICE=DHF8256GB25442874`.)

## 4. Checks

Hygiene: NONE — no unit tests cover this gate; only the two builds compiled (runs 1–2) and the R8 mapping was read
Functional run: on the Titan as the user — the release (KCAM) and the debug (Debug KCAM) each launched from the
launcher activity; READ: screenshots of the preview, the Layers / source picker / Scenes / FAB menu / Settings
screens, the About long-press result in both builds, `uiautomator` dumps, `logcat -b crash`, `dumpsys activity
broadcasts`, `apksigner` output, `mapping.txt`

| Case | Status | Observation |
|---|---|---|
| Signatures | pass | debug CN=Debug KCAM, OU=KrinikCam, O=KOT KRINIK, C=BY; release CN=KCAM, same OU/O/C (runs 3–4) |
| R8 on release | pass | `mapping.txt`, `usage.txt` produced; APK 11.2 MB; `DevMenuScreen` and `DevSettings` absent from mapping (stripped) |
| Release starts | pass | in focus, permission dialogs approved, «Please stand by» slate (fresh scene = «Нет источника») — screen 06 |
| Release preview | pass | after picking «Основная камера (id 0)» a live camera image renders — screen 09 |
| Release: no virtual debug camera | pass | source picker lists «Основная камера (id 0)», «Селфи-камера (id 1)», «Нет источника» only — screen 08 |
| Release panels under R8 | pass | Layers (07), layer settings (08), Scenes («Сцена 1», «Новая сцена» — 10), FAB menu (В эфир, Запись, Фото, Платформы, Кодер, Настройки — 11), Settings (12–13) all open |
| Release: Developer menu unreachable | pass | 2.5 s long-press on «KrinikCam» → the ordinary project-info dialog (same as a tap) shows «release · v0.8 (74)»; no «Для разработчиков» — screen 14 |
| Release: no harness receivers | pass | only the USB monitor receiver; no `com.kriniks.kcam.CMD` / `SET_VIRTUAL_CAM` / `SET_ORIENTATION` (run 13) |
| Release: crashes | pass | `logcat -b crash` 0 lines after the whole walk |
| Debug: control — long-press opens Developer | pass | «Для разработчиков» with ADB rotation / virtual camera / stream-to-file toggles — screen 04 |
| Debug: owner's data survives the key switch | pass | Scenes lists «Сцена — копия», «Сцена 1», «Сцена 2», «Сцена 3» — same as the backup DB — screen 02 |
| «4020mV» readout | skipped | not ours: it is drawn on the launcher too (screen 05) — the tablet's system UI |
| UVC webcam under R8 | skipped | no UVC camera attached; only the USB monitor start is proven |
| Release with `true` left in dev prefs | skipped | release was installed fresh; covered only by the R8 mapping (getters folded to `false`) |

## 5. Found

- none

## 6. Traces

- 16 screenshots of this run were DELETED at the owner's word (2026-10-17: «testcases/reports/assets/2026-10-17/, и - вычистить», «все скриншоты темстовые ВСЕГДА ПОД ГИТИГНОРОМ»): they showed his room; the observations are recorded in Checks above. Test frames are kept locally only (gitignored) from now on.
- app/build/outputs/mapping/release/mapping.txt, usage.txt (local build output, not in git)
- build logs: C:\Users\krinik\AppData\Local\Temp\claude\d--work-ai-sandbox-KrinikCam\6f845770-f419-44e2-af3c-9e3d03c4df6d\scratchpad\r\build_debug.log, build_release.log, build_times.txt
- data backup: C:\Users\krinik\AppData\Local\Temp\claude\d--work-ai-sandbox-KrinikCam\6f845770-f419-44e2-af3c-9e3d03c4df6d\scratchpad\kcam_debug_data_2.tar

## 7. Verdict

pass — both builds are signed with the .env keys, the R8 release starts, previews the camera and opens every
panel without crashes, and its Developer menu, virtual camera and harness receivers are gone, while the debug
keeps them and the owner's scenes; the UVC frame path under R8 remains unproven (no webcam attached).
