/**
 * Egl — минимальное EGL/GLES2-ядро для нашего GL-композитора (Idea 25, «мобильный OBS»).
 *
 * По канону grafika: [EglCore] создаёт EGLContext (GLES2) с флагом RECORDABLE (для MediaCodec/энкодера),
 * [WindowSurface] оборачивает выходной `Surface` в EGLSurface (рисуем туда композит). Достаточно для
 * рендера слоёв в SurfaceTexture энкодера RootEncoder (наш CompositorVideoSource = базовый источник).
 *
 * Сознательно компактно и без зависимостей — только android.opengl.*.
 */

package com.kriniks.kcam.feature.streaming.gl

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.view.Surface

private const val EGL_RECORDABLE_ANDROID = 0x3142

/** EGL-контекст GLES2 с конфигом, пригодным для энкодерной поверхности (RECORDABLE). */
class EglCore {
    private val display: EGLDisplay
    private val context: EGLContext
    private val config: EGLConfig

    init {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        check(display != EGL14.EGL_NO_DISPLAY) { "eglGetDisplay failed" }
        val version = IntArray(2)
        check(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize failed" }

        // Рисуем в SurfaceTexture RootEncoder'а (он сам кодирует) — это НЕ прямой вход MediaCodec,
        // поэтому EGL_RECORDABLE_ANDROID НЕ нужен и сужает выбор конфига так, что eglCreateWindowSurface
        // на обычной SurfaceTexture падает ("no valid Surface"). Берём обычный RGBA8 ES2-конфиг.
        val attribList = intArrayOf(
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_NONE,
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val numConfigs = IntArray(1)
        check(EGL14.eglChooseConfig(display, attribList, 0, configs, 0, 1, numConfigs, 0) && numConfigs[0] > 0) {
            "eglChooseConfig failed"
        }
        config = configs[0]!!

        val ctxAttribs = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
        context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, ctxAttribs, 0)
        check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed" }
    }

    fun createWindowSurface(surface: Surface): EGLSurface {
        val attribs = intArrayOf(EGL14.EGL_NONE)
        val eglSurface = EGL14.eglCreateWindowSurface(display, config, surface, attribs, 0)
        check(eglSurface != EGL14.EGL_NO_SURFACE) { "eglCreateWindowSurface failed" }
        return eglSurface
    }

    fun makeCurrent(eglSurface: EGLSurface) {
        check(EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)) { "eglMakeCurrent failed" }
    }

    fun swapBuffers(eglSurface: EGLSurface): Boolean = EGL14.eglSwapBuffers(display, eglSurface)

    /** Временная метка кадра (нс) — нужна, чтобы энкодер получал корректные PTS. */
    fun setPresentationTime(eglSurface: EGLSurface, nsecs: Long) {
        EGLExt14.setPresentationTime(display, eglSurface, nsecs)
    }

    fun releaseSurface(eglSurface: EGLSurface) {
        EGL14.eglDestroySurface(display, eglSurface)
    }

    fun release() {
        EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        EGL14.eglDestroyContext(display, context)
        EGL14.eglReleaseThread()
        EGL14.eglTerminate(display)
    }
}

/** Обёртка над EGLExt (eglPresentationTimeANDROID) — вынесена, чтобы не тянуть импорт всюду. */
private object EGLExt14 {
    fun setPresentationTime(display: EGLDisplay, surface: EGLSurface, nsecs: Long) {
        android.opengl.EGLExt.eglPresentationTimeANDROID(display, surface, nsecs)
    }
}
