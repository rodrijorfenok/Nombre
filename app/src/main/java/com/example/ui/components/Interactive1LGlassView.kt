package com.example.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RotateRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.AlcoholIntensity
import com.example.data.model.DrinkSize
import com.example.ui.theme.*
import kotlin.math.cos
import kotlin.math.sin

@Composable
fun Interactive1LGlassView(
    modifier: Modifier = Modifier,
    primaryColor: Color = NeonLime,
    secondaryColor: Color = NeonPink,
    garnishEmoji: String = "🥒",
    garnishName: String = "Pepino",
    drinkSize: DrinkSize = DrinkSize.VASO_1L,
    intensity: AlcoholIntensity = AlcoholIntensity.EQUILIBRADO,
    hasLedGlow: Boolean = false,
    hasExtraIce: Boolean = true,
    showControls: Boolean = true
) {
    var rotationAngle by remember { mutableFloatStateOf(0f) }
    var tiltAngle by remember { mutableFloatStateOf(0f) }
    var isLedActive by remember(hasLedGlow) { mutableStateOf(hasLedGlow) }

    // Bubbles animation
    val infiniteTransition = rememberInfiniteTransition(label = "drink_anim")
    val waveOffset by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(2400, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "wave"
    )
    val glowPulse by infiniteTransition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "glow"
    )

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(DarkSurfaceVariant)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Glass Badge Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                color = NeonLime.copy(alpha = 0.15f),
                shape = RoundedCornerShape(12.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, NeonLime.copy(alpha = 0.5f))
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(text = "🍹", fontSize = 12.sp)
                    Text(
                        text = drinkSize.volumeLabel + " " + drinkSize.badge,
                        color = NeonLime,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Surface(
                color = NeonPink.copy(alpha = 0.15f),
                shape = RoundedCornerShape(12.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, NeonPink.copy(alpha = 0.4f))
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(text = intensity.icon, fontSize = 11.sp)
                    Text(
                        text = intensity.label,
                        color = NeonPinkLight,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Main Glass Interactive Canvas
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(260.dp)
                .pointerInput(Unit) {
                    detectDragGestures { change, dragAmount ->
                        change.consume()
                        rotationAngle = (rotationAngle + dragAmount.x * 0.5f).coerceIn(-45f, 45f)
                        tiltAngle = (tiltAngle + dragAmount.y * 0.3f).coerceIn(-20f, 20f)
                    }
                },
            contentAlignment = Alignment.Center
        ) {
            Canvas(
                modifier = Modifier
                    .fillMaxSize()
                    .testTag("interactive_glass_canvas")
            ) {
                val canvasWidth = size.width
                val canvasHeight = size.height

                // Draw Neon Backlight Glow
                if (isLedActive) {
                    drawCircle(
                        brush = Brush.radialGradient(
                            colors = listOf(
                                NeonPink.copy(alpha = 0.45f * glowPulse),
                                NeonCyan.copy(alpha = 0.25f * glowPulse),
                                Color.Transparent
                            ),
                            center = Offset(canvasWidth / 2, canvasHeight / 2),
                            radius = canvasHeight * 0.65f
                        )
                    )
                }

                val cupTopWidth = canvasWidth * 0.46f
                val cupBottomWidth = canvasWidth * 0.34f
                val cupHeight = canvasHeight * 0.78f
                val cupTopY = canvasHeight * 0.14f
                val cupBottomY = cupTopY + cupHeight

                val centerX = canvasWidth / 2 + (rotationAngle * 1.5f)

                val leftTop = Offset(centerX - cupTopWidth / 2, cupTopY)
                val rightTop = Offset(centerX + cupTopWidth / 2, cupTopY)
                val leftBottom = Offset(centerX - cupBottomWidth / 2, cupBottomY)
                val rightBottom = Offset(centerX + cupBottomWidth / 2, cupBottomY)

                // Liquid fill level (e.g. 85% for 1L)
                val fillPercentage = when (drinkSize) {
                    DrinkSize.VASO_1L -> 0.86f
                    DrinkSize.VASO_TERMICO_1L -> 0.90f
                    DrinkSize.JARRA_FIESTA_1_5L -> 0.94f
                }

                val liquidTopY = cupBottomY - (cupHeight * fillPercentage)
                val liquidLeftX = leftBottom.x + (leftTop.x - leftBottom.x) * fillPercentage
                val liquidRightX = rightBottom.x + (rightTop.x - rightBottom.x) * fillPercentage

                // Draw Liquid
                val liquidPath = Path().apply {
                    moveTo(liquidLeftX, liquidTopY)
                    // Animated waves at top surface of liquid
                    val waveAmp = 4f
                    val waveFreq = 3
                    val step = (liquidRightX - liquidLeftX) / 20f
                    for (i in 0..20) {
                        val x = liquidLeftX + i * step
                        val y = liquidTopY + sin(Math.toRadians((waveOffset + i * 20.0)).toFloat()) * waveAmp
                        if (i == 0) moveTo(x, y) else lineTo(x, y)
                    }
                    lineTo(rightBottom.x - 4f, rightBottom.y - 4f)
                    lineTo(leftBottom.x + 4f, leftBottom.y - 4f)
                    close()
                }

                val liquidBrush = Brush.verticalGradient(
                    colors = listOf(
                        secondaryColor.copy(alpha = 0.88f),
                        primaryColor.copy(alpha = 0.95f),
                        primaryColor.copy(alpha = 1.0f)
                    ),
                    startY = liquidTopY,
                    endY = cupBottomY
                )
                drawPath(liquidPath, liquidBrush)

                // Draw Carbonation / Bubbles
                for (b in 0..12) {
                    val bubbleProgress = ((waveOffset * 1.5f + b * 45f) % 180f) / 180f
                    val bubbleY = cupBottomY - (cupHeight * fillPercentage * bubbleProgress)
                    val bubbleX = centerX - (cupBottomWidth * 0.35f) + (b * 19f) % (cupBottomWidth * 0.7f)
                    if (bubbleY > liquidTopY && bubbleY < cupBottomY) {
                        drawCircle(
                            color = Color.White.copy(alpha = 0.6f * (1f - bubbleProgress)),
                            radius = (2.5f + (b % 3)),
                            center = Offset(bubbleX, bubbleY)
                        )
                    }
                }

                // Draw Ice Cubes
                if (hasExtraIce) {
                    val icePositions = listOf(
                        Offset(centerX - 30f, liquidTopY + 35f),
                        Offset(centerX + 20f, liquidTopY + 25f),
                        Offset(centerX - 10f, liquidTopY + 75f),
                        Offset(centerX + 35f, liquidTopY + 95f),
                        Offset(centerX - 25f, liquidTopY + 125f)
                    )
                    for ((idx, pos) in icePositions.withIndex()) {
                        drawRoundRect(
                            color = Color.White.copy(alpha = 0.45f),
                            topLeft = Offset(pos.x - 18f, pos.y - 18f),
                            size = Size(36f, 36f),
                            cornerRadius = CornerRadius(6f, 6f)
                        )
                        // Ice cube reflection highlight
                        drawRoundRect(
                            color = Color.White.copy(alpha = 0.8f),
                            topLeft = Offset(pos.x - 14f, pos.y - 14f),
                            size = Size(10f, 10f),
                            cornerRadius = CornerRadius(3f, 3f)
                        )
                    }
                }

                // Draw Sorbete XL (Giant Straw)
                val strawTop = Offset(rightTop.x - 15f - (rotationAngle * 0.5f), cupTopY - 45f)
                val strawBottom = Offset(leftBottom.x + 25f, cupBottomY - 15f)
                drawLine(
                    color = NeonPink,
                    start = strawTop,
                    end = strawBottom,
                    strokeWidth = 10f,
                    cap = StrokeCap.Round
                )
                drawLine(
                    color = Color.White.copy(alpha = 0.6f),
                    start = strawTop,
                    end = strawBottom,
                    strokeWidth = 3f,
                    cap = StrokeCap.Round
                )

                // Draw 1-Liter Measurement Markings on the glass
                val markSteps = listOf(
                    0.25f to "250 ml",
                    0.50f to "500 ml",
                    0.75f to "750 ml",
                    0.86f to "1 LITRO ★"
                )
                for ((ratio, label) in markSteps) {
                    val markY = cupBottomY - (cupHeight * ratio)
                    val markLeft = leftBottom.x + (leftTop.x - leftBottom.x) * ratio + 8f
                    drawLine(
                        color = Color.White.copy(alpha = 0.6f),
                        start = Offset(markLeft, markY),
                        end = Offset(markLeft + 16f, markY),
                        strokeWidth = 2f
                    )
                }

                // Glass Cup Outline & Highlights (3D Glass Look)
                val glassPath = Path().apply {
                    moveTo(leftTop.x, leftTop.y)
                    lineTo(rightTop.x, rightTop.y)
                    lineTo(rightBottom.x, rightBottom.y)
                    lineTo(leftBottom.x, leftBottom.y)
                    close()
                }

                // Glass Rim
                drawOval(
                    color = Color.White.copy(alpha = 0.5f),
                    topLeft = Offset(centerX - cupTopWidth / 2, cupTopY - 8f),
                    size = Size(cupTopWidth, 16f),
                    style = Stroke(width = 3f)
                )

                // Outer Glass Frame
                drawPath(
                    path = glassPath,
                    color = Color.White.copy(alpha = 0.35f),
                    style = Stroke(width = 3.5f)
                )

                // Left Glass Reflection Specular
                val specularPath = Path().apply {
                    moveTo(leftTop.x + 8f, leftTop.y + 12f)
                    lineTo(leftTop.x + 14f, leftTop.y + 12f)
                    lineTo(leftBottom.x + 12f, leftBottom.y - 12f)
                    lineTo(leftBottom.x + 8f, leftBottom.y - 12f)
                    close()
                }
                drawPath(specularPath, color = Color.White.copy(alpha = 0.28f))
            }

            // Garnish Overlay Badge (Emoji on rim)
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .offset(x = 36.dp, y = 14.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(DarkSurface.copy(alpha = 0.85f))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(text = garnishEmoji, fontSize = 18.sp)
                    Text(
                        text = garnishName,
                        fontSize = 11.sp,
                        color = TextPrimary,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            // Drag hint at bottom
            Text(
                text = "↔ Deslizá para girar el vaso 1L",
                color = TextMuted,
                fontSize = 10.sp,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 4.dp)
            )
        }

        if (showControls) {
            Spacer(modifier = Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // LED Glow Toggle
                FilterChip(
                    selected = isLedActive,
                    onClick = { isLedActive = !isLedActive },
                    label = {
                        Text(
                            text = if (isLedActive) "LED Neón ON 💡" else "Luz Neón OFF",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                    },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = NeonPink.copy(alpha = 0.25f),
                        selectedLabelColor = NeonPinkLight
                    )
                )

                // Reset Orientation Button
                IconButton(
                    onClick = {
                        rotationAngle = 0f
                        tiltAngle = 0f
                    }
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Centrar Vaso",
                        tint = TextSecondary
                    )
                }
            }
        }
    }
}
