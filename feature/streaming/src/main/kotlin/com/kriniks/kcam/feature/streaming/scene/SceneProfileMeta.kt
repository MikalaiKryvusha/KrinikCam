/**
 * SceneProfileMeta — лёгкая мета именованной сцены для UI (idea 40 / plans/18 Фаза 1-2).
 * id + имя + настройки ПЕРЕХОДА (снапшот UI не нужен — панель-менеджер показывает список и активную).
 * Related: SceneProfileRepository, StreamViewModel, панель сцен в MainScreen, CompositorVideoSource.
 */

package com.kriniks.kcam.feature.streaming.scene

/**
 * plans/18 Фаза 2 (Криник) — ТИП ПЕРЕХОДА при включении сцены. Как в OBS, эффект принадлежит сцене,
 * НА которую переключаются: «включаю BRB — она выезжает», независимо от того, откуда пришли.
 *
 *  NONE  — мгновенно (прежнее поведение; композитор всё равно держит старый кадр, пока новая сцена
 *          не готова, — чтобы не мелькала чернота, пока камера открывается).
 *  FADE  — кросс-фейд: старая сцена гаснет поверх новой.
 *  SLIDE — выезд: старая сцена уезжает влево, открывая новую.
 */
enum class SceneTransition {
    NONE, FADE, SLIDE;

    companion object {
        /** Разбор из строки БД (:data:profiles хранит имя enum). Неизвестное/старое → FADE (дефолт схемы). */
        fun fromStorage(value: String?): SceneTransition =
            entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: FADE
    }
}

// Границы длительности перехода (мс): ниже 100 эффект не читается, выше 3с — мешает стримеру.
const val SCENE_TRANSITION_MIN_MS = 100
const val SCENE_TRANSITION_MAX_MS = 3000

data class SceneProfileMeta(
    val id: Long,
    val name: String,
    // plans/18 Фаза 2 — переход ЭТОЙ сцены (тип + длительность), редактируется в модалке сцены.
    val transition: SceneTransition = SceneTransition.FADE,
    val transitionDurationMs: Int = 400,
)
