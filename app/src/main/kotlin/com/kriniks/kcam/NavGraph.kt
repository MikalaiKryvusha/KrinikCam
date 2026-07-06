/**
 * NavGraph — Compose Navigation graph for KrinikCam.
 *
 * Phase 1 routes:
 *   main     → MainScreen (fullscreen viewfinder)
 *   settings → SettingsScreen
 *
 * Future routes (Phase 4+):
 *   device_manager → DeviceManagerScreen
 *   profiles       → ProfilesScreen
 *
 * Related: MainActivity, MainScreen, SettingsScreen
 */

package com.kriniks.kcam

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.kriniks.kcam.core.logging.FileLogger
import com.kriniks.kcam.feature.capture.DeviceManager
import com.kriniks.kcam.ui.screens.DevMenuScreen
import com.kriniks.kcam.ui.screens.MainScreen
import com.kriniks.kcam.ui.screens.SettingsScreen
import com.kriniks.kcam.ui.screens.UserManualScreen

object Routes {
    const val MAIN = "main"
    const val SETTINGS = "settings"
    const val DEVELOPER = "developer"
    const val USER_MANUAL = "user_manual"   // Idea 32 / plans/06 — встроенное руководство
}

@Composable
fun KrinikCamNavGraph(
    deviceManager: DeviceManager,
    fileLogger: FileLogger,
    // Applied live by MainActivity when the "ADB rotation" dev toggle changes (Idea 07).
    onAdbRotationChanged: (Boolean) -> Unit,
    // Idea 10 — "stream to file" dev toggle → StreamingRepository (wired in MainActivity).
    onVirtualStreamChanged: (Boolean) -> Unit,
    navController: NavHostController = rememberNavController(),
) {
    NavHost(navController = navController, startDestination = Routes.MAIN) {

        composable(Routes.MAIN) {
            MainScreen(
                onNavigateToSettings = { navController.navigate(Routes.SETTINGS) },
                deviceManager = deviceManager,
            )
        }

        composable(Routes.SETTINGS) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                fileLogger = fileLogger,
                // Long-press on the "KrinikCam" About row opens the hidden Developer menu.
                onOpenDeveloper = { navController.navigate(Routes.DEVELOPER) },
                // plans/06 — встроенное руководство пользователя.
                onOpenManual = { navController.navigate(Routes.USER_MANUAL) },
            )
        }

        composable(Routes.USER_MANUAL) {
            UserManualScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.DEVELOPER) {
            DevMenuScreen(
                onBack = { navController.popBackStack() },
                onAdbRotationChanged = onAdbRotationChanged,
                // Idea 09 — toggle the virtual debug camera via DeviceManager (it drives the source).
                onVirtualCameraChanged = { deviceManager.setVirtualCamera(it) },
                // Idea 10 — toggle "stream to file" (record instead of RTMP).
                onVirtualStreamChanged = onVirtualStreamChanged,
            )
        }
    }
}
