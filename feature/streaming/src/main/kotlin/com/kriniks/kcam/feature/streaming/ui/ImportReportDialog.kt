/**
 * ImportReportDialog — УНИВЕРСАЛЬНАЯ модалка отчёта импорта (Криник, 2026-07-19).
 *
 * Показывает честно, ЧТО при импорте пошло не по плану: каких полей не хватило (поставили дефолт), где
 * пришло кривое/неизвестное значение (поставили fallback). Кнопка «Понял» закрывает. Принимает любой
 * [ImportReport] — переиспользуется для ВСЕХ импортов (платформы, профили кодера, будущие сцены и т.д.).
 *
 * Показывать ТОЛЬКО когда `report.hasIssues` (чистый импорт — обычным снэкбаром). Related: ImportReport.
 */

package com.kriniks.kcam.feature.streaming.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kriniks.kcam.data.profiles.model.ImportIssue
import com.kriniks.kcam.data.profiles.model.ImportReport
import com.kriniks.kcam.feature.streaming.R

private val AcidPink = Color(0xFFFF1A8C)

@Composable
fun ImportReportDialog(report: ImportReport, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.import_report_ok), color = AcidPink, fontWeight = FontWeight.Bold)
            }
        },
        title = { Text(stringResource(R.string.import_report_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.import_report_intro), fontSize = 13.sp)
                Spacer(Modifier.height(12.dp))
                report.issues.forEach { issue ->
                    val line = when (issue) {
                        is ImportIssue.MissingField ->
                            stringResource(R.string.import_issue_missing, issue.item, issue.field, issue.fallback)
                        is ImportIssue.MalformedField ->
                            stringResource(R.string.import_issue_malformed, issue.item, issue.field, issue.received, issue.fallback)
                        is ImportIssue.UnknownValue ->
                            stringResource(R.string.import_issue_unknown, issue.item, issue.field, issue.received, issue.fallback)
                    }
                    Text("•  $line", fontSize = 13.sp, modifier = Modifier.padding(vertical = 3.dp))
                }
            }
        },
    )
}
