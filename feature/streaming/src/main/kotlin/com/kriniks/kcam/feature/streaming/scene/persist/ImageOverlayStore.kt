/**
 * ImageOverlayStore — файловое хранилище PNG-оверлеев сцены (idea 40 / plans/18 Фаза 0).
 *
 * Слой-картинка (`Layer.Image`) держит `Bitmap` в памяти — для персиста сцены его надо положить ФАЙЛОМ.
 * Директория `filesDir/overlays/`, имя файла = `<layerId>.png`. Слой-картинка ИММУТАБЕЛЬНА (bitmap не
 * меняется на месте), поэтому [ensureSaved] пишет файл ОДИН раз и переиспользует его на последующих
 * автосейвах (важно: автосейв зовётся часто — не переписываем PNG каждый кадр жеста).
 *
 * Related: SceneSnapshotMapper (зовёт ensureSaved/load), SceneSnapshotRepository (зовёт pruneExcept).
 */

package com.kriniks.kcam.feature.streaming.scene.persist

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.kriniks.kcam.core.logging.KLog
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.io.FileOutputStream
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ImageOverlayStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    // Директория оверлеев (создаётся лениво при первом обращении).
    private val dir: File
        get() = File(context.filesDir, "overlays").apply { if (!exists()) mkdirs() }

    /**
     * Гарантировать PNG-файл оверлея для слоя [layerId]. Если файл уже есть (непустой) — НЕ переписываем
     * (слой-картинка иммутабельна, автосейв частый). PNG — сохраняем альфу. Возвращает абсолютный путь.
     */
    fun ensureSaved(layerId: String, bitmap: Bitmap): String {
        val file = File(dir, "$layerId.png")
        if (file.exists() && file.length() > 0) return file.absolutePath
        runCatching {
            FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
        }.onFailure { KLog.e(TAG, "ensureSaved($layerId) failed: ${it.message}") }
        return file.absolutePath
    }

    /** Загрузить bitmap оверлея по пути (null — файла нет / битый). */
    fun load(path: String): Bitmap? =
        runCatching { BitmapFactory.decodeFile(path) }.getOrNull()

    /**
     * Удалить файлы-сироты: всё в `overlays/` (только top-level ФАЙЛЫ; сабдиры сцен НЕ трогает), чей путь
     * НЕ в актуальном наборе [keepPaths]. Зовётся после сохранения снапшота Ф0-репозиторием И как разовая
     * чистка легаси-плоских оверлеев после сева первой именованной сцены (Фаза 1).
     */
    fun pruneExcept(keepPaths: Set<String>) {
        dir.listFiles()?.forEach { f ->
            if (f.isFile && f.absolutePath !in keepPaths) runCatching { f.delete() }
        }
    }

    // ── Namespace-изоляция оверлеев по сцене (idea 40 / plans/18 Фаза 1) ─────────────────────────────
    // При НЕСКОЛЬКИХ сценах layerId ("overlay_1") может повторяться между сценами → плоский путь
    // `overlays/<layerId>.png` дал бы коллизию (файлы одной сцены затирают/удаляют файлы другой при
    // pruneExcept). Решение: каждая сцена держит оверлеи в СВОЁМ сабдире `overlays/scene_<id>/`.

    /** Сабдир оверлеев конкретной сцены (создаётся лениво). */
    private fun nsDir(namespace: String): File =
        File(dir, namespace).apply { if (!exists()) mkdirs() }

    /** Как [ensureSaved], но в сабдире сцены [namespace] → `overlays/<namespace>/<layerId>.png`. */
    fun ensureSaved(namespace: String, layerId: String, bitmap: Bitmap): String {
        val file = File(nsDir(namespace), "$layerId.png")
        if (file.exists() && file.length() > 0) return file.absolutePath
        runCatching {
            FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
        }.onFailure { KLog.e(TAG, "ensureSaved($namespace/$layerId) failed: ${it.message}") }
        return file.absolutePath
    }

    /** Чистка сирот ВНУТРИ сабдира одной сцены (не трогает другие сцены). */
    fun pruneNamespaceExcept(namespace: String, keepPaths: Set<String>) {
        nsDir(namespace).listFiles()?.forEach { f ->
            if (f.isFile && f.absolutePath !in keepPaths) runCatching { f.delete() }
        }
    }

    /** Удалить весь сабдир оверлеев сцены (при удалении сцены). */
    fun deleteNamespace(namespace: String) {
        runCatching { File(dir, namespace).deleteRecursively() }
    }

    companion object { private const val TAG = "ImageOverlayStore" }
}
