# Ревизия кода 2026-07-12 — полный отчёт аудита (4 зоны)

> Проведена по запросу Криника (дом родителей, Titan 1 @ 192.168.1.3, Piko+ подключена).
> 4 параллельных аудитора: streaming/композитор · usb/capture/codec · app/core · data+tools.
> Спорное поведение библиотек проверялось по байткоду из Gradle-кеша (javap), не по докам.
> Версия на момент аудита: 0.6 (12), commit 641e3ef.
>
> **Главные кластеры вынесены в баг-доки: bugs/34 (мультистрим), bugs/35 (USB-мост),
> bugs/36 (эфир в фоне/FGS), bugs/37 (данные юзера/release), bugs/38 (exported receivers),
> bugs/39 (CMD-протокол).** Планы фиксов: plans/09–12. Здесь — ПОЛНЫЙ список, включая
> средние/мелкие находки, чтобы ничего не потерялось.

## Зона 1: feature/streaming (композитор + RTMP + мультистрим)

Критикал/хай — см. bugs/34. Прочее:

- MEDIUM `RtmpStreamer.kt:128,173-177` — гонка видимости: `cameraLayerSurface` пишется GL-потоком,
  читается main без синхронизации (не `@Volatile`, в отличие от соседних полей) → `opener.open()`
  возможен на released SurfaceTexture.
- MEDIUM `CompositorVideoSource.kt:295-301,361-363` — рендер-луп `postDelayed(FRAME_MS)` ПОСЛЕ
  drawFrame → фактические ~25-28 fps вместо 30 (дрейф на время кадра); `drawFrame` глотает все
  исключения одним `KLog.w`, результат `swapBuffers` игнорируется → мёртвая поверхность энкодера =
  молча замороженный стрим при state=Live.
- MEDIUM `CompositorVideoSource.kt:443-457` + `StreamViewModel.kt:179-196` — утечка GL-текстуры при
  дублировании слоя (один Bitmap на два слоя; syncTextures грузит вторую текстуру и теряет её).
- MEDIUM `RtmpStreamer.kt:459-487` — stop(): `surface?.release()` немедленно, а `eglDestroySurface`
  в отложенном post → EGLSurface может пережить Surface; `pendingCapture` не дренируется (потеря
  колбэка фото); при падении `createWindowSurface` в initGl частично созданный EglCore не
  освобождается.
- MEDIUM `RtmpStreamer.kt:233-236` — `onAuthError` НЕ останавливает стрим: UI показывает Error, а
  энкодер и выходы реально работают.
- MEDIUM `RtmpStreamer.kt:707,719-722` — `startRecordToFile`: `isStreamSetupInProgress` висит true
  всю запись (аварийный конец записи заблокирует `setVideoRotation` навсегда); `_state=Live` ставится
  ДО `startRecord`.
- MEDIUM `StreamViewModel.kt:277-298` — фолбэк `enabled.ifEmpty { activeProfile }` стримит на явно
  ВЫКЛЮЧЕННУЮ платформу; `profiles` (WhileSubscribed) пуст без UI-подписчика (харнес); ложное
  сообщение «Failed to start encoder» при пустых stream-ключах.
- LOW: `activeRtmpOutputs` — мёртвый учёт; дубли математики жестов/снапа repo vs VM (tear-off только
  в VM); `Live.durationMs`/`droppedFrames` — мёртвые поля; `Stopping` ненаблюдаем.
- ✅ Перепроверено, дефекта НЕТ: порядок `prepareVideo(w,h,BITRATE,fps)` верен (javap);
  `setCameraOrientation(0)` после prepareVideo и на всех превью-путях (исторический bug 02).

## Зона 2: feature/usb + capture + codec

Хай-кластер жизненного цикла камер — см. bugs/35 (мост) и bugs/34-смежные. Детали:

- HIGH `MainScreen.kt:155-160` + `UsbViewModel.kt:72-81` — `notifyUvcDisconnected` мёртв для активной
  камеры: VM атомарно зануляет `activeCameraId` И убирает девайс; LaunchedEffect перезапускается уже
  на новом состоянии → return до вызова. Фантомные UvcCamera копятся в `DeviceManager._uvcSources`,
  авто-фолбэк не срабатывает. (bugs/35)
- HIGH `UsbDeviceRepositoryImpl.kt:174` — `initCamera` перезаписывает `openCameras[deviceId]` без
  закрытия старого Camera → утечка нативного UVC-хендла + двойные коллбэки при connect-спаме.
- HIGH `CameraLayerOpeners.kt:93-116` — reopen фазы-2 зовёт `openCamera()` ВТОРОЙ раз без close;
  по байткоду AUSBC 3.2.7 `openCamera` всегда создаёт новый HandlerThread и перезаписывает handler —
  первая нативная сессия не останавливается никогда (риск native-краха bug 28).
- HIGH `DeviceCamera.kt:139-162,208-214` — Camera2: гонка `close()` vs `onOpened` → встроенная камера
  может остаться захваченной до убийства процесса. Фикс: `@Volatile closed` + close в onOpened.
- MEDIUM `UsbDeviceRepositoryImpl.kt:115-127` — дебаунс requestPermission одноместный
  (`lastPermDeviceId`) — при 2+ устройствах не работает вообще.
- MEDIUM bug 33 (уточнение по байткоду libuvc): `USBMonitor.requestPermission` САМ проверяет
  `hasPermission` и при true идёт в `processConnect` БЕЗ диалога → диалог на каждом replug = грант
  реально отсутствует в момент вызова. Манифест-автогрант персистит только при галке «Открывать по
  умолчанию». Плюс гонка: автогрант ATTACHED-интента может примениться ПОЗЖЕ auto-requestPermission.
  → отложенная перепроверка + обработка onNewIntent. (обновлено в bugs/33)
- MEDIUM `UsbViewModel.kt:64-70` — `connectedDevices + event.device` без дедупа по deviceId.
- MEDIUM `DeviceManager.kt:86-90` — `notifyUvcConnected` без дедупа → дубликат источника с тем же id
  при пересоздании композиции.
- MEDIUM `CameraLayerOpeners.kt:93-94` — `Thread.sleep(1500)` как тайминг негоциации; сигнал
  OPENED/PreviewStarted уже есть — sleep не нужен.
- MEDIUM `CameraLayerOpeners.kt:109-113` — TOCTOU-гонка bug 31 сужена, но не закрыта (между
  `if (closed)` и `openAt` конкурентный close может отдать поверхность следующему источнику).
- MEDIUM `CodecScanner.kt:57-62` — `getSupportedFrameRatesFor(maxW,maxH)` может кинуть непойманный
  IllegalArgumentException (upper×upper не обязаны быть валидной парой) → падает весь scan().
- MEDIUM `UsbDeviceRepositoryImpl.kt:163-165` — ошибки негоциации (err=-9/-99, State.ERROR)
  молчаливые: не чистится map, юзеру не показывается, фолбэк не запускается → чёрный слой.
- LOW: хардкод-фолбэк 1920/1080 в PreviewStarted маскирует реальный размер; не-атомарные RMW в
  DeviceManager (контракт main-thread нигде не зафиксирован); `PreviewStopped` не эмитится нигде;
  `restartMonitoring` на каждый результат permission-диалога (лишний churn); `onDisconnected`/`onError`
  Camera2 не чистят session/thread; ReceiverFlagFixContext хрупок к апдейту AUSBC.
- ФАКТ (для plans/08 UVC-контролы): AUSBC 3.2.7 `CameraRequest.Builder` НЕ имеет выбора формата
  (только width/height/cameraId/frontCamera/AF) — 2K по MJPEG требует апгрейда AUSBC 3.3.x или форка.

## Зона 3: app + core

Критикал (FGS/эфир в фоне) — bugs/36; exported receivers — bugs/38. Прочее:

- HIGH `UsbDeviceRepositoryImpl.kt:64-101` — `startMonitoring()` не идемпотентен: повторный вызов
  затирает `multiCameraClient` без unRegister старого → утечка USBMonitor-receiver + ДУБЛИ событий
  attach/permission (вклад в bug 33). (bugs/35)
- MEDIUM `MainActivity.kt:41,70` vs `MainScreen.kt:106` — ДВА разных экземпляра UsbViewModel
  (activity-scoped + hiltViewModel route-scoped); работает случайно (общий SharedFlow синглтона);
  onCleared любого зовёт stopMonitoring для всех.
- MEDIUM `FileLogger.kt:33-57` — параллельные launch на IO → строки вне порядка/перемешиваются;
  SimpleDateFormat не thread-safe; ротация только по дням без лимита размера; каждый log() =
  корутина + open/close файла. Фикс: однопоточный актор + size-cap.
- MEDIUM `KrinikCamApp.kt:38-86` — crash_*.txt копятся вечно (prune только logs/); после проглоченного
  «benign» SecurityException USBMonitor-поток мёртв, авто-restart не реализован.
- MEDIUM `MainScreen.kt:155-160` — LaunchedEffect с ключом по РАЗМЕРУ списка (коалесценция состояний
  теряет detach+attach). (bugs/35)
- MEDIUM `MainScreen.kt:82-99 vs 316-323` — hitTestLayer квадратный axis-aligned, а рамка выделения
  адаптивная по аспекту и повороту → тап «мимо рамки».
- MEDIUM `StreamPlatformsOverlay.kt:233-235` — удаление профиля платформы одним тапом БЕЗ
  подтверждения (stream key теряется безвозвратно; у слоёв диалог есть).
- LOW-MEDIUM `MainScreen.kt:171-197` — LaunchedEffect читает не-ключи activeCameraWidth/Height →
  фактически всегда работает фолбэк 1920×1080.
- LOW: отказ CAMERA/RECORD_AUDIO обрабатывается молча (нет индикации на главном экране); снэкбары
  ошибок стрима теряются, когда MainScreen не в композиции (replay=0); UI-состояние на remember
  вместо rememberSaveable (process death); DevMenuScreen читает DevSettings один раз (CMD-изменения
  не видны); CMD-receiver exported в debug (осознать/signature-permission); POST_NOTIFICATIONS
  объявлен, но не запрашивается.
- LOW (массово) — конвенция локализации (Idea 14) нарушена: хардкод RU/EN-текста в MainScreen,
  SettingsScreen, FloatingRadialMenu, StreamPlatformsOverlay, снэкбарах StreamViewModel.
- ✅ Чисто: onDestroy снимает все receiver'ы; UvcPreviewView стопит GL до release (bug 02);
  UvcCameraOpener.close отменяет reopen (bug 31); PermissionsSection различает askable/permanently
  denied; FileProvider не экспортирован.

## Зона 4: data/profiles + tools + gradle

Критикал (destructive migration, debug signing, ключи в логах, versionCode) — bugs/37. Прочее:

- MEDIUM `AppDatabase.kt:21` — `exportSchema = false` (нет истории схем → миграции не написать/не
  оттестировать).
- MEDIUM `StreamProfileEntity.kt:30` — `StreamPlatform.valueOf` — краш всего Flow профилей на
  неизвестном значении.
- MEDIUM `StreamPlatformsOverlay.kt:77,85` — I/O экспорта/импорта профилей на main thread (SAF может
  быть сетевым → ANR).
- MEDIUM `StreamProfile.kt:42` — кривые дефолтные RTMP-URL: Twitch `/live` (канон `/app`), INSTAGRAM
  указывает на Facebook Live endpoint, TikTok — несуществующий generic. «Настроил по дефолту — не
  коннектится».
- LOW: DataStore `catch { emit(emptyPreferences()) }` глотает всё; висячий activeProfileId после
  удаления профиля; повторный импорт дублирует профили; ключи открытым текстом в БД/экспорте
  (смягчено allowBackup=false — осознанно, но подумать про Keystore).
- HIGH `tools/adb.mjs` — вообще нет поддержки ADB_DEVICE/`-s` (при 2 устройствах падает
  `more than one device`); ui.mjs/smoke.mjs поддерживают — рассинхрон тулчейна.
- HIGH `ui.mjs:622` vs `MainActivity.kt:201-213` — CMD-протокол: `select-source builtin <id>` СЛОМАН
  (ui.mjs шлёт «builtin,2», ресивер парсит только `\s+`). (bugs/39)
- MEDIUM — gesture-pinch: `cmd gesture-pinch in 0.5` выполняет pinch-OUT (парс первого токена);
  `[frac]`/`[radiusFrac]` из help ресивером не используются; `ui.mjs pinch` шлёт arg с пробелом
  (сам себе противоречит). (bugs/39)
- MEDIUM `commit.mjs:41` — сообщение коммита в шелл-строке (кавычки/`$` ломают/инжектят); бамп
  version.json ДО коммита (фейл = дырка в нумерации).
- MEDIUM `release.mjs:68` — нет JBR-фолбэка (build.mjs имеет); дублирование сборочной логики.
- LOW: release.mjs — бамп до сборки, тег до gh release, finally удаляет переименованный APK;
  adb.mjs logcat печатается дважды; ui.mjs adb() через execSync+join(' '); rtmp-server macIp()
  только en0; докодрифт help/KDoc CMD-ресивера; proguard мёртвое keep-правило entity;
  buildTime ломает configuration cache.
- ФАКТ: захардкоженных IP/serial в tools НЕТ (только в доке UI_AUTOMATION_GUIDE) — резолвинг через
  env ADB_DEVICE, иначе первое устройство.

## Сводные рекомендации (импрувменты по ценности для стримера)

1. **Реконнект с бэкоффом + изоляция выходов мультистрима** (plans/09) — самая большая ценность на
   единицу кода; библиотека уже умеет (`shouldRetry`/`reTry`).
2. **Foreground service + keepScreenOn + wake lock** (plans/10) — эфир должен переживать экран/фон.
3. **Adaptive bitrate + живая статистика эфира** (ideas/37) — `hasCongestion`/`setVideoBitrateOnFly`;
   заполнить мёртвые durationMs/droppedFrames; чинит боль «Piko+ лагает».
4. **Мост USB→DeviceManager вне Compose** (plans/11) — application-scoped коллектор событий;
   детерминированный выбор разрешения (open→OPENED→close→open(best), кэш best per-device) вместо
   sleep(1500)+reopen.
5. **Release-гигиена** (plans/12): Room-миграции + exportSchema, release keystore, redactRtmp() в
   логах, формула versionCode, выверить дефолтные RTMP-URL.
6. Тулчейн: единый adb-хелпер (ADB_DEVICE) для adb.mjs; контрактный тест CMD-протокола в smoke.mjs;
   FileLogger-актор; диагностика источника в UI (idea 20).
