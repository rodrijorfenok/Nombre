package com.example.ui.screens.tracking

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.*
import com.example.ui.theme.*

@Composable
fun OrderTrackingScreen(
    currentOrder: Order?,
    orderHistory: List<Order>,
    onAdvanceDemoStep: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current

    val infiniteTransition = rememberInfiniteTransition(label = "rider")
    val riderOffset by infiniteTransition.animateFloat(
        initialValue = 0.15f,
        targetValue = 0.85f,
        animationSpec = infiniteRepeatable(
            animation = tween(4000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "rider_offset"
    )

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBg)
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DarkSurface)
                .padding(horizontal = 20.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Moped,
                    contentDescription = null,
                    tint = NeonLime,
                    modifier = Modifier.size(24.dp)
                )
                Text(
                    text = "Seguimiento en Vivo",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Black,
                    color = TextPrimary
                )
            }

            if (currentOrder != null) {
                Surface(
                    color = NeonLime.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        text = currentOrder.id,
                        color = NeonLime,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
        }

        HorizontalDivider(color = DarkBorder)

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (currentOrder == null) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = DarkSurface),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Column(
                            modifier = Modifier.padding(32.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(text = "🛵", fontSize = 48.sp)
                            Spacer(modifier = Modifier.height(12.dp))
                            Text(
                                text = "No tenés pedidos activos en curso",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = TextPrimary
                            )
                            Text(
                                text = "Hacé tu pedido de tragos de 1 litro y vas a poder seguir el estado de la barra y el delivery en tiempo real.",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextSecondary,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                modifier = Modifier.padding(top = 6.dp)
                            )
                        }
                    }
                }
            } else {
                // Live Active Order Card
                item {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(20.dp))
                            .border(1.dp, NeonLime.copy(alpha = 0.4f), RoundedCornerShape(20.dp)),
                        colors = CardDefaults.cardColors(containerColor = DarkSurface)
                    ) {
                        Column(modifier = Modifier.padding(18.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(
                                        text = currentOrder.status.title,
                                        style = MaterialTheme.typography.titleLarge,
                                        fontWeight = FontWeight.Black,
                                        color = NeonLime
                                    )
                                    Text(
                                        text = currentOrder.status.subtitle,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextSecondary
                                    )
                                }
                                Text(text = currentOrder.status.iconEmoji, fontSize = 32.sp)
                            }

                            Spacer(modifier = Modifier.height(16.dp))

                            // Route Animation Simulation
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant),
                                shape = RoundedCornerShape(14.dp)
                            ) {
                                Column(modifier = Modifier.padding(14.dp)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column {
                                            Text(
                                                text = "TIEMPO ESTIMADO",
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = TextMuted
                                            )
                                            Text(
                                                text = currentOrder.estimatedArrival,
                                                fontSize = 18.sp,
                                                fontWeight = FontWeight.Black,
                                                color = TextPrimary
                                            )
                                        }
                                        Surface(
                                            color = NeonLime.copy(alpha = 0.15f),
                                            shape = RoundedCornerShape(8.dp)
                                        ) {
                                            Text(
                                                text = if (currentOrder.deliveryMethod == DeliveryMethod.DELIVERY) "Moto Térmica 🛵" else "Retiro en Barra 🏪",
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = NeonLime,
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                            )
                                        }
                                    }

                                    Spacer(modifier = Modifier.height(14.dp))

                                    // Progress Bar with Animated Scooter
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(24.dp),
                                        contentAlignment = Alignment.CenterStart
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .height(6.dp)
                                                .clip(RoundedCornerShape(3.dp))
                                                .background(DarkBorder)
                                        )
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth(riderOffset)
                                                .height(6.dp)
                                                .clip(RoundedCornerShape(3.dp))
                                                .background(
                                                    Brush.horizontalGradient(
                                                        listOf(NeonPink, NeonLime)
                                                    )
                                                )
                                        )
                                        Text(
                                            text = "🛵",
                                            fontSize = 18.sp,
                                            modifier = Modifier
                                                .align(Alignment.CenterStart)
                                                .offset(x = (300 * riderOffset).dp - 12.dp, y = (-2).dp)
                                        )
                                    }

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Text(text = "Barra (San Miguel)", fontSize = 10.sp, color = TextMuted)
                                        Text(text = currentOrder.deliveryAddress, fontSize = 10.sp, color = NeonLime, maxLines = 1)
                                    }
                                }
                            }

                            Spacer(modifier = Modifier.height(16.dp))

                            // Preparation Steps
                            Text(
                                text = "ESTADO DE LA BARRA",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextMuted,
                                letterSpacing = 1.sp
                            )
                            Spacer(modifier = Modifier.height(8.dp))

                            OrderStatus.values().forEach { step ->
                                val isPassed = step.stepIndex <= currentOrder.status.stepIndex
                                val isCurrent = step == currentOrder.status
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Surface(
                                        shape = CircleShape,
                                        color = if (isPassed) NeonLime else DarkBorder,
                                        modifier = Modifier.size(22.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            if (isPassed) {
                                                Icon(
                                                    imageVector = Icons.Default.Check,
                                                    contentDescription = null,
                                                    tint = Color.Black,
                                                    modifier = Modifier.size(12.dp)
                                                )
                                            }
                                        }
                                    }
                                    Column {
                                        Text(
                                            text = step.title,
                                            fontSize = 13.sp,
                                            fontWeight = if (isCurrent) FontWeight.Black else FontWeight.Medium,
                                            color = if (isCurrent) NeonLime else if (isPassed) TextPrimary else TextMuted
                                        )
                                        Text(
                                            text = step.subtitle,
                                            fontSize = 11.sp,
                                            color = TextSecondary
                                        )
                                    }
                                }
                            }

                            Spacer(modifier = Modifier.height(14.dp))

                            // Advance Demo Step Button
                            OutlinedButton(
                                onClick = onAdvanceDemoStep,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("simulate_tracking_step_button"),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = NeonLime)
                            ) {
                                Text(text = "Simular Próximo Paso en Barra ⚡", fontSize = 12.sp)
                            }
                        }
                    }
                }
            }

            // Order History Section
            if (orderHistory.isNotEmpty()) {
                item {
                    Text(
                        text = "HISTORIAL DE PEDIDOS",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextMuted,
                        letterSpacing = 1.sp
                    )
                }

                items(orderHistory) { pastOrder ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .border(1.dp, DarkBorder, RoundedCornerShape(14.dp)),
                        colors = CardDefaults.cardColors(containerColor = DarkSurface)
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = pastOrder.id,
                                    fontWeight = FontWeight.Bold,
                                    color = NeonLime,
                                    fontSize = 13.sp
                                )
                                Text(
                                    text = "$${pastOrder.total.toInt()}",
                                    fontWeight = FontWeight.Black,
                                    color = TextPrimary,
                                    fontSize = 14.sp
                                )
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            pastOrder.items.forEach { itm ->
                                Text(
                                    text = "• ${itm.quantity}x ${itm.drink.name} (${itm.size.title})",
                                    fontSize = 12.sp,
                                    color = TextSecondary
                                )
                            }
                        }
                    }
                }
            }

            // Help & Contact Box
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Text(text = "💬", fontSize = 22.sp)
                            Column {
                                Text(
                                    text = "¿Dudas con tu entrega?",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 13.sp,
                                    color = TextPrimary
                                )
                                Text(
                                    text = "Contactate con la barra de San Miguel",
                                    fontSize = 11.sp,
                                    color = TextSecondary
                                )
                            }
                        }

                        Button(
                            onClick = {
                                val url = "https://wa.me/${SanMiguelZones.WHATSAPP_PHONE}?text=Hola%20LitroBar%20San%20Miguel,%20tengo%20una%20consulta%20sobre%20mi%20pedido"
                                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                                context.startActivity(intent)
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = WhatsAppColor),
                            shape = RoundedCornerShape(10.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text(text = "WhatsApp", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
