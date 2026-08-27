package com.example.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme = darkColorScheme(
    primary = NeonLime,
    onPrimary = Color(0xFF0D1E04),
    primaryContainer = Color(0xFF223508),
    onPrimaryContainer = NeonLimeLight,

    secondary = NeonPink,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFF4A0A1F),
    onSecondaryContainer = NeonPinkLight,

    tertiary = NeonCyan,
    onTertiary = Color(0xFF002025),
    tertiaryContainer = Color(0xFF00363E),
    onTertiaryContainer = Color(0xFF70F5FF),

    background = DarkBg,
    onBackground = TextPrimary,
    surface = DarkSurface,
    onSurface = TextPrimary,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = TextSecondary,
    outline = DarkBorder,
    outlineVariant = Color(0xFF383B4C)
)

private val LightColorScheme = DarkColorScheme // LitroBar maintains a vibrant dark bar ambiance

@Composable
fun MyApplicationTheme(
    darkTheme: Boolean = true,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = Typography,
        content = content
    )
}

@Composable
fun LitroBarTheme(
    darkTheme: Boolean = true,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    MyApplicationTheme(
        darkTheme = darkTheme,
        dynamicColor = dynamicColor,
        content = content
    )
}
