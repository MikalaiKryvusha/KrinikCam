/**
 * UiText — локализуемый текст из ViewModel БЕЗ Context во ViewModel (plans/13 S2).
 *
 * Снэкбары StreamViewModel раньше эмитили готовые строки (вперемешку RU/EN — нарушение Idea 14).
 * VM не должен держать Context (утечка/нелокализуемость), поэтому эмитим ССЫЛКУ на ресурс с
 * аргументами, а резолвит UI-слой (у него Context есть всегда):
 *   VM:  _snackbar.emit(UiText.Res(R.string.snack_record_failed))
 *   UI:  viewModel.snackbar.collect { showSnackbar(it.resolve(context)) }
 *
 * Raw — для строк, которые локализовать нечем (пути файлов, имена из данных).
 * Related: StreamViewModel (_snackbar), MainScreen (коллектор), plans/13.
 */

package com.kriniks.kcam.feature.streaming.ui

import android.content.Context
import androidx.annotation.StringRes

sealed class UiText {
    /** Ссылка на строковый ресурс + позиционные аргументы форматирования. */
    data class Res(@StringRes val id: Int, val args: List<Any> = emptyList()) : UiText()

    /** Сырая строка (нелокализуемое: путь, имя из данных). */
    data class Raw(val text: String) : UiText()

    /** Резолв в готовую строку на стороне UI (единственное место, где нужен Context). */
    fun resolve(context: Context): String = when (this) {
        is Res -> context.getString(id, *args.toTypedArray())
        is Raw -> text
    }
}
