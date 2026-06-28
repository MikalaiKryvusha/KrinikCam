# Bug 01 — Black screen: GL pipeline never starts

**Status:** ✅ FIXED (2026-06-28)  
**Symptom:** USB camera connects, logs show "USB camera opened", but screen stays black.  
**Secondary:** App crashes when pressing Go Live (IllegalStateException).

---

## Evidence (from device logcat)

```
startPreview: tv=1600x2560 isOnPreview=true glRunning=false
startPreview: done — glRunning=false        ← GL never reaches isRunning=true
GL still not running after 3000ms — giving up
```

Pattern repeats in a loop — camera opens/closes continuously, GL never starts.

---

## Root Cause Analysis (bytecode decompilation of RootEncoder 2.4.7)

### Root Cause 1 — Double trigger (PRIMARY)

`startPreviewOnView()` is called from TWO places in `MainScreen.kt`:

1. `LaunchedEffect(usbState.activeCamera)` — when camera connects, sets source AND calls startPreview
2. `UvcPreviewView.onTextureViewReady` — when TextureView surface is ready, calls startPreview

When BOTH happen quickly (camera already connected when TextureView becomes ready), the second
`startPreviewOnView()` call triggers:
```
startPreview() → if (stream.isOnPreview) stream.stopPreview()
```

`GlStreamInterface.stop()` calls `threadQueue.clear()` — this **cancels the pending GL init lambda**
from the first `startPreview()`. The lambda that calls `running.set(true)` never executes.
Result: `isRunning` stays `false` forever.

### Root Cause 2 — Race condition (SECONDARY)

Even in the single-trigger case, `StreamBase.startPreview()` calls:
```java
if (!videoSource.isRunning()) {
    videoSource.start(glInterface.getSurfaceTexture());  // synchronous, before GL thread runs
}
```

GL init is async (submitted to executor). `getSurfaceTexture()` returns null or stale value before
the EGL context is set up. Camera opens with bad SurfaceTexture → frames go nowhere.

The retry mechanism (`scheduleVideoSourceRetryIfNeeded`) was supposed to fix this, but RC1 kills
the GL init lambda before it can set `running=true`, so the retry waits 3000ms and gives up.

### Root Cause 3 — prepareVideo crash

`StreamBase.prepareVideo()` throws `IllegalStateException` if `isOnPreview=true`. Since preview
starts automatically when camera connects, calling `startStream()` while preview is running → crash.

---

## GlStreamInterface internals (key discovery)

```
GlStreamInterface.start() → creates NEW executor per call → submits GL init lambda
GlStreamInterface.stop()  → running.set(false) + threadQueue.clear()  ← CANCELS pending lambdas!
running.set(true)          → happens inside the lambda, AFTER EglSetup() in GL thread
```

So any `stop()` after `start()` but before the lambda executes = permanent `isRunning=false`.

---

## Fix

### Fix 1: Eliminate double trigger (MainScreen.kt)

Remove `startPreviewOnView(tv)` from `LaunchedEffect(usbState.activeCamera)`.
Preview is only triggered from `onTextureViewReady`. `LaunchedEffect` only calls `setVideoSource()`.

This ensures `stopPreview()` is never called while GL init lambda is in the queue.

### Fix 2 — ROOT CAUSE: Set encoder size before GL start (RtmpStreamer.kt)

`start$lambda$5` (GL init lambda) calls `mainRender.initGl(ctx, encoderWidth, encoderHeight, ...)`.
`encoderWidth/Height` are `0` until `prepareVideo()` is called. With 0 values, `initGl()` crashes.
`secureSubmit()` catches the exception and swallows it silently → `running.set(true)` never reached.

Fix: in `startPreview()`, check `stream.getGlInterface().encoderSize.x == 0` and call
`stream.getGlInterface().setEncoderSize(1920, 1080)` to give GL valid dimensions before init.
`prepareVideo()` will overwrite this with actual profile values when user presses Go Live.

Confirmed by device logs:
```
startPreview: encoderSize=0 — setting 1920x1080 default so GL can init
SurfaceManager: GL initialized
startPreview: done — glRunning=true    ← SUCCESS
GL ready after 0ms — re-triggering VideoSource
USB camera opened via GL SurfaceTexture (1920x1080)
```

### Fix 3: Use currentVideoSource at retry time (RtmpStreamer.kt)

`scheduleVideoSourceRetryIfNeeded()` now reads `currentVideoSource` inside the coroutine after
the wait (not captured at schedule time). Camera reconnect between schedule and retry picks up fresh source.

### Fix 4: Stop preview before prepareVideo, restore after (RtmpStreamer.kt)

In `startStream()`: `if (stream.isOnPreview) stream.stopPreview()` before `prepareVideo()`.
Fixes `IllegalStateException: Stream, record and preview must be stopped before prepareVideo`.
After prepare + startStream, `schedulePreviewRestoreAfterStream()` restores preview once GL is ready.

### Fix 5: Auto orientation handling

`stream.getGlInterface().autoHandleOrientation = true` in `startPreview()`.
Sensor-driven rotation — GL pipeline handles portrait/landscape natively.

---

## Files Changed

- `app/src/main/kotlin/com/kriniks/kcam/ui/screens/MainScreen.kt`
- `feature/streaming/src/main/kotlin/com/kriniks/kcam/feature/streaming/rtmp/RtmpStreamer.kt`

---

## Additional Bug Found During Fix — Landscape Orientation

When device rotated to landscape, GL render stayed portrait-sized (1600×2560 surface).
`AspectRatioMode.Adjust` scaled the 1920×1080 feed into that portrait-sized surface,
then the landscape TextureView (2560×1600) clipped it — result: tiny image top-left.

**Fix:** `UvcPreviewView.onSurfaceTextureSizeChanged` callback added. `MainScreen` calls
`startPreviewOnView(tv)` on size change (via `rememberUpdatedState` to get fresh camera state).
This restarts the GL pipeline with the new surface dimensions on each rotation.

`setAutoHandleOrientation(true)` was tried but WRONG for USB webcam — it rotates the video
output by sensor angle, making the image 90° sideways. USB webcam is physically fixed,
so no GL rotation is wanted. `AspectRatioMode.Adjust` alone handles letterboxing correctly.

---

## Test Criteria

- [x] Camera connects → preview appears (**glRunning=true confirmed in logs**)
- [x] Log shows `GL ready after 0ms` — camera opens immediately, no 3000ms wait
- [x] Rotating device → video fills screen correctly in both portrait and landscape ✅
- [ ] Go Live → no crash (no IllegalStateException) — fix implemented, not yet tested
- [ ] Go Live → stream connects → LIVE indicator visible
