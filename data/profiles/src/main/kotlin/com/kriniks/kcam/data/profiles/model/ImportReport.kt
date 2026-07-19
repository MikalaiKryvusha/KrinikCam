/**
 * ImportReport / JsonImportReader — УНИВЕРСАЛЬНЫЙ менеджер импорта (Криник, 2026-07-19).
 *
 * Задача: при импорте JSON честно сообщать пользователю, ЧТО пошло не по плану, а не молча подставлять
 * дефолты (как делал `coerceInputValues` в kotlinx). Любой декодер домена (платформы, профили кодера, в
 * будущем — сцены и др.) читает поля через [JsonImportReader], а тот собирает [ImportIssue]:
 *   • поля не было в файле       → [ImportIssue.MissingField]  (поставили дефолт),
 *   • поле кривого типа/формата  → [ImportIssue.MalformedField] (поставили дефолт),
 *   • известный ключ, но НЕИЗВЕСТНОЕ значение (напр. кодек "H999") → [ImportIssue.UnknownValue] (дефолт).
 * Итог — [ImportReport], который UI показывает модалкой (ImportReportDialog, кнопка «Понял»).
 *
 * ПЕРЕИСПОЛЬЗУЕМЫЙ КОНТРАКТ: `decodeWithReport(text): Pair<List<T>, ImportReport>` — единый вид у всех
 * кодеков импорта (ProfilesBackupCodec, EncoderProfilesBackupCodec, …). Reader ниже — общий инструмент.
 *
 * Related: ProfilesBackupCodec, EncoderProfilesBackupCodec, ImportReportDialog (UI), StreamViewModel.
 */

package com.kriniks.kcam.data.profiles.model

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/** Одно замечание при импорте: к какому объекту/полю относится и какой fallback поставили. */
sealed class ImportIssue {
    abstract val item: String   // ярлык объекта (имя профиля / «#индекс»), чтобы отчёт был понятен
    abstract val field: String

    /** Поля не было в файле — поставили [fallback] (дефолт). */
    data class MissingField(override val item: String, override val field: String, val fallback: String) : ImportIssue()

    /** Поле было, но тип/формат не тот (ждали число, пришла строка и т.п.) — поставили [fallback]. */
    data class MalformedField(override val item: String, override val field: String, val received: String, val fallback: String) : ImportIssue()

    /** Известный ключ, но НЕИЗВЕСТНОЕ значение (напр. неизвестный кодек) — поставили [fallback]. */
    data class UnknownValue(override val item: String, override val field: String, val received: String, val fallback: String) : ImportIssue()
}

/** Итог импорта: сколько внесено/пропущено дублей и список замечаний (пусто = всё чисто). */
data class ImportReport(
    val issues: List<ImportIssue> = emptyList(),
    val imported: Int = 0,
    val skippedDuplicates: Int = 0,
) {
    val hasIssues: Boolean get() = issues.isNotEmpty()
    /** Полный провал парсинга (ничего не внесено и нет осмысленных замечаний). */
    val isTotalFailure: Boolean get() = imported == 0 && issues.isEmpty()
}

/**
 * Универсальный ЧИТАТЕЛЬ полей одного JSON-объекта со сбором [ImportIssue] в общий [issues]. Каждый метод
 * возвращает значение поля ИЛИ [default], фиксируя замечание. [item] — ярлык объекта для отчёта.
 */
class JsonImportReader(
    private val obj: JsonObject,
    private val item: String,
    private val issues: MutableList<ImportIssue>,
) {
    private fun prim(field: String): JsonPrimitive? = obj[field] as? JsonPrimitive

    fun string(field: String, default: String): String {
        val p = prim(field) ?: return default.also { issues.add(ImportIssue.MissingField(item, field, default)) }
        return p.contentOrNull ?: default.also { issues.add(ImportIssue.MalformedField(item, field, p.toString(), default)) }
    }

    fun int(field: String, default: Int): Int {
        val p = prim(field) ?: return default.also { issues.add(ImportIssue.MissingField(item, field, default.toString())) }
        return p.intOrNull ?: default.also { issues.add(ImportIssue.MalformedField(item, field, p.contentOrNull ?: p.toString(), default.toString())) }
    }

    fun long(field: String, default: Long): Long {
        val p = prim(field) ?: return default.also { issues.add(ImportIssue.MissingField(item, field, default.toString())) }
        return p.longOrNull ?: default.also { issues.add(ImportIssue.MalformedField(item, field, p.contentOrNull ?: p.toString(), default.toString())) }
    }

    fun bool(field: String, default: Boolean): Boolean {
        val p = prim(field) ?: return default.also { issues.add(ImportIssue.MissingField(item, field, default.toString())) }
        return p.booleanOrNull ?: default.also { issues.add(ImportIssue.MalformedField(item, field, p.contentOrNull ?: p.toString(), default.toString())) }
    }

    /**
     * Enum по ИМЕНИ (как хранит kotlinx). Нет ключа → MissingField+default; известный ключ с неизвестным
     * значением → UnknownValue+default. [values] = `EnumType.values()`.
     */
    fun <E : Enum<E>> enumByName(field: String, values: Array<E>, default: E): E {
        val p = prim(field) ?: return default.also { issues.add(ImportIssue.MissingField(item, field, default.name)) }
        val raw = p.contentOrNull ?: return default.also { issues.add(ImportIssue.MalformedField(item, field, p.toString(), default.name)) }
        return values.firstOrNull { it.name == raw } ?: default.also { issues.add(ImportIssue.UnknownValue(item, field, raw, default.name)) }
    }

    companion object {
        /**
         * Достать массив объектов [field] из корня: поддерживаем и обёртку `{..., "<field>": [...]}`, и
         * голый массив `[...]`. null — если ни то ни другое (парсер вернёт пустой результат).
         */
        fun arrayField(root: JsonElement, field: String): JsonArray? = when (root) {
            is JsonArray -> root
            is JsonObject -> root[field] as? JsonArray
            else -> null
        }

        /** Ярлык объекта для отчёта: имя из поля "name" или «#индекс». */
        fun labelOf(obj: JsonObject, index: Int): String =
            (obj["name"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() } ?: "#${index + 1}"
    }
}
