/**
 * SessionBadge — ЕДИНСТВЕННОЕ место, где решается вопрос «идёт ЭФИР или идёт ЗАПИСЬ В ФАЙЛ».
 *
 * Зачем отдельный файл ради одной функции (bug 79). Это же решение раньше принималось ДВАЖДЫ:
 * в плашке статуса (MainScreen) — верно, с учётом записи; и в главном FAB (FloatingActionMenu) —
 * неверно, безусловной константой `fab_live_badge`. Кнопка писала «ЭФИР» во время записи в файл,
 * то есть врала стримеру о том, что происходит. При этом ПОЧИНЕННЫЙ экземпляр (плашка) маскировал
 * живой класс — ровно урок EXP-0047 и родня bug 77.
 *
 * Поэтому фикс здесь — не второй `if` внутри FAB, а СНЯТИЕ ДУБЛИРОВАНИЯ: решение живёт в одном
 * месте, оба потребителя его зовут, и следующий потребитель уже физически не может «забыть»
 * про запись (BUG_FIXING_FRAMEWORK.md → «закрывай класс, а не экземпляр», чини ФОРМОЙ).
 *
 * Гард класса: `node tools/lint-source.mjs` следит, что `R.string.fab_live_badge` и
 * `R.string.fab_rec_badge` не упоминаются НИГДЕ, кроме этого файла — иначе решение снова разъедется
 * по экранам, и следующий раз о нём сообщит Криник, а не мы.
 *
 * Related: StreamState (флаг isRecording), MainScreen (плашка статуса), FloatingActionMenu (главный
 * FAB), bugs/79_fab_says_live_during_file_recording.md
 */

package com.kriniks.kcam.ui

import androidx.annotation.StringRes
import com.kriniks.kcam.R
import com.kriniks.kcam.feature.streaming.model.StreamState

/**
 * Идёт ли СЕССИЯ ЗАПИСИ В ФАЙЛ (в отличие от эфира).
 *
 * Запись переиспользует те же состояния `Connecting`/`Live`, что и эфир, — различает их только флаг
 * `isRecording` внутри каждого. Разбор sealed-класса собран здесь, чтобы каждый потребитель UI не
 * делал его по-своему (именно расхождение таких разборов и есть класс дефекта bug 79).
 *
 * [TESTED: 2026-08-02 · A51: ветка Live проверена в обе стороны — запись в файл и эфир на полигон
 *  (см. sessionBadgeRes). Ветка Connecting здесь аддитивна и на бейдж пока не влияет: FAB рисует
 *  бейдж только при isLive, а фаза подготовки имеет свою пилюлю (PreparingStatusPill)]
 */
val StreamState.isRecordingSession: Boolean
    get() = when (this) {
        is StreamState.Live -> isRecording
        is StreamState.Connecting -> isRecording
        else -> false
    }

/**
 * Подпись бейджа активной сессии: «ЗАПИСЬ»/`REC` при записи в файл, «ЭФИР»/`LIVE` в эфире.
 * ЕДИНСТВЕННАЯ точка выбора этого ресурса во всём приложении (bug 79).
 *
 * [TESTED: 2026-08-02 · A51 (0.8 (47), ru_RU), скриншоты обеих веток:
 *  запись в файл (`stream-to-file on` + `go-live`) → FAB «ЗАПИСЬ» + плашка «ЗАПИСЬ • 00:26»;
 *  эфир на локальный RTMP-полигон (`go-live-rtmp`) → FAB «ЭФИР» + плашка «ЭФИР • 00:09».
 *  До фикса FAB печатал «ЭФИР» в обоих случаях]
 */
@StringRes
fun sessionBadgeRes(state: StreamState): Int =
    if (state.isRecordingSession) R.string.fab_rec_badge else R.string.fab_live_badge
