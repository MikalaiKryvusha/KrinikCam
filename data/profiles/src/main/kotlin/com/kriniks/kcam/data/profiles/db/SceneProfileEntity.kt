/**
 * SceneProfileEntity — Room table row for a NAMED scene profile (эпик idea 40, plans/18 Фаза 1).
 *
 * Хранит ОДНУ именованную сцену: имя + сериализованный снапшот сцены (SceneSnapshotDto как JSON-строка,
 * та же форма, что Ф0 писала в DataStore "current_scene_json"). Слой :data:profiles НЕ знает про типы
 * сцены — snapshotJson здесь ОПАКОВАЯ строка; сериализация/десериализация живёт в :feature:streaming
 * (SceneSnapshotRepository / SceneProfileRepository).
 *
 * Таблица scene_profiles (schema v5, MIGRATION_4_5). Related: AppDatabase, SceneProfileDao, ProfilesModule.
 *
 * [NOT-TESTED] — свежесгенерировано; проверяется живой миграцией + round-trip на устройстве.
 */

package com.kriniks.kcam.data.profiles.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "scene_profiles")
data class SceneProfileEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val snapshotJson: String,   // SceneSnapshotDto → JSON (опаковая для этого слоя)
    val createdAt: Long,        // epoch ms — метаданные (не участвует в диффе/сравнении)
    val updatedAt: Long,        // epoch ms — обновляется на каждом автосейве активной сцены
    // plans/18 Фаза 2 (Криник) — ПЕРЕХОД при включении ЭТОЙ сцены: как в OBS, эффект принадлежит
    // сцене, НА которую переключаются. Тип — имя enum SceneTransition ("NONE"/"FADE"/"SLIDE";
    // строка, потому что :data:profiles не знает доменных типов :feature:streaming), длительность —
    // мс. Дефолты = прежнее поведение мгновенной смены не ломают: FADE 400мс мягче и безопаснее
    // чёрной склейки, поэтому взят дефолтом (schema v6, MIGRATION_5_6). [NOT-TESTED]
    val transitionType: String = "FADE",
    val transitionDurationMs: Int = 400,
)
