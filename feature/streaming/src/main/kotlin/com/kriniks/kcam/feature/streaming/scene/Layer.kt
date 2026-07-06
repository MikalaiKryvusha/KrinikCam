/**
 * Layer — один источник в рабочей области сцены (фундамент мульти-источников, Idea 19).
 *
 * Аналог слоя в OBS: сцена держит УПОРЯДОЧЕННЫЙ список слоёв, нижний (index 0) рисуется первым,
 * верхние — поверх. Видимость переключается «глазом». Это доменная модель — она НЕ зависит от
 * backend рендера (см. interview_005): слои рисует наш GL-композитор
 * (`CompositorVideoSource`, Phase 3), но модель/UI от бэкенда не зависят и переживут его смену.
 *
 * Первый заход (минимальный вертикальный срез, Q1=A): два типа — [Camera] (базовый слой, сама
 * USB-камера = VideoSource энкодера) и [Image] (PNG-оверлей поверх). Остальные типы из Q2
 * (видео-оверлей, текст, 2-я камера, анимации, заглушка) добавляются по этой же модели позже.
 */

package com.kriniks.kcam.feature.streaming.scene

import android.graphics.Bitmap

/**
 * CaptureSource — КАКОЙ физический источник кадров питает слой «Устройство захвата видео»
 * ([Layer.VideoCapture]). Архитектурное решение (plans/05 §0): камеры — ОДИН тип слоя, а конкретное
 * устройство (виртуалка / UVC / любая встроенная камера ОС) — вот это полиморфное свойство. Тип слоя
 * определяет РЕНДЕР (для композитора все камеры = OES-текстура + квад, одинаково), а CaptureSource —
 * лишь СПОСОБ ДОБЫЧИ кадров.
 *
 * Это ЛЁГКИЙ доменный дескриптор без backend (модуль :feature:streaming не зависит от :feature:capture
 * / :feature:usb). Маппинг `CaptureSource → CameraOpener` (Uvc/Device/Virtual) делает :app, который
 * бриджит все модули (см. CameraLayerOpeners).
 */
sealed interface CaptureSource {
    /** Человекочитаемое имя устройства для UI выбора («Селфи-камера», «2K USB Camera», …). */
    val displayName: String

    /** Встроенная камера устройства (Camera2) — ЛЮБАЯ из родных камер ОС: селфи/тыл/ширик/макро/микроскоп. */
    data class Builtin(val cameraId: String, override val displayName: String) : CaptureSource

    /** USB UVC-вебка (AUSBC) — конкретное подключённое устройство из списка. */
    data class Uvc(val deviceId: String, override val displayName: String) : CaptureSource

    /** Виртуальная дебаг-камера (тест-паттерн, Idea 09) — работа/тесты без реальной камеры. */
    object Virtual : CaptureSource {
        override val displayName = "Виртуальная камера"
    }

    /** Источник не выбран — слой рисует чёрную базу (позже — фейд-заглушку KrinikCam, plans/05 S7). */
    object None : CaptureSource {
        override val displayName = "Нет источника"
    }
}

/**
 * Трансформа слоя в кадре (PiP «лицо в углу», Idea 25 шаг 4): куда и какого размера рисуется слой.
 *
 * Координаты НОРМАЛИЗОВАНЫ к кадру (не зависят от разрешения): [scale] — доля кадра, занимаемая слоем
 * (1 = во весь кадр, 0.25 = четверть); [cx],[cy] — центр слоя в [0,1], где (0,0)=верх-лево, (1,1)=низ-право
 * (привычная экранная система; GL-композитор сам переведёт в clip-space с Y-флипом). [alpha] — прозрачность.
 *
 * Дефолт ([fullFrame]) — во весь кадр по центру, непрозрачно: так ведут себя слои до ручной трансформы.
 */
data class LayerTransform(
    val scale: Float = 1f,
    val cx: Float = 0.5f,
    val cy: Float = 0.5f,
    val alpha: Float = 1f,
    /**
     * Поворот СОДЕРЖИМОГО слоя внутри сцены в градусах CW (interview_006 Q3: слои трансформируются
     * «как в Photoshop»). Например, «лежащую» device-камеру выпрямляют rotation=90/270. Поворот
     * аспект-корректный (без сплющивания); повёрнутый слой может выйти за холст — ужимается scale.
     */
    val rotation: Int = 0,
) {
    companion object {
        val FULL = LayerTransform()
    }
}

sealed interface Layer {
    /** Стабильный идентификатор слоя (для reorder/toggle/remove и будущего сериализованного профиля). */
    val id: String

    /** Человекочитаемое имя для панели «Слои». */
    val name: String

    /** Виден ли слой в компоновке (выключенный «глаз» = слой есть в сцене, но не рисуется). */
    val visible: Boolean

    /** Трансформа слоя в кадре (позиция/масштаб/альфа). Дефолт — во весь кадр (см. [LayerTransform]). */
    val transform: LayerTransform

    /**
     * Слой «Устройство захвата видео» (Video Capture Device) — камера как слой композитора.
     * ЕДИНСТВЕННЫЙ тип для ВСЕХ камер (виртуалка / UVC / любая встроенная ОС-камера); конкретное
     * устройство — в поле [source] (см. [CaptureSource] и plans/05 §0). В сцене таких слоёв может
     * быть НЕСКОЛЬКО экземпляров одновременно (напр. UVC + фронталка PiP, потолок ~10 — Фаза B).
     * Композитор рисует поток слоя OES-текстурой + квадом с [transform] — одинаково для любого source.
     */
    data class VideoCapture(
        override val id: String = "camera",
        override val name: String = "Устройство захвата видео",
        override val visible: Boolean = true,
        override val transform: LayerTransform = LayerTransform.FULL,
        val source: CaptureSource = CaptureSource.None,
    ) : Layer

    /**
     * Слой-картинка (PNG с альфой) поверх камеры — логотип, рамка, «сейчас вернусь». Держит готовый
     * [bitmap]; GL-композитор рисует его квадом с [transform] (PiP-позиция/масштаб/альфа).
     */
    data class Image(
        override val id: String,
        override val name: String,
        override val visible: Boolean = true,
        override val transform: LayerTransform = LayerTransform.FULL,
        val bitmap: Bitmap,
    ) : Layer
}
