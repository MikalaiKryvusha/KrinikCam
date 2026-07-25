/**
 * SceneProfileMeta — лёгкая мета именованной сцены для UI (idea 40 / plans/18 Фаза 1).
 * Только id + имя (снапшот UI не нужен — панель-менеджер показывает список и активную).
 * Related: SceneProfileRepository, StreamViewModel, панель сцен в MainScreen.
 */

package com.kriniks.kcam.feature.streaming.scene

data class SceneProfileMeta(
    val id: Long,
    val name: String,
)
