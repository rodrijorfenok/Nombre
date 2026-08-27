package com.example.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.DeliveryMethod
import com.example.data.model.DeliveryZone
import com.example.data.model.SanMiguelZones
import com.example.ui.theme.*

@Composable
fun SanMiguelZoneBanner(
    currentZone: DeliveryZone,
    deliveryMethod: DeliveryMethod,
    onZoneClick: () -> Unit,
    onMethodToggle: (DeliveryMethod) -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .border(1.dp, DarkBorder, RoundedCornerShape(16.dp)),
        colors = CardDefaults.cardColors(containerColor = DarkSurface)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            // Delivery / Take Away Switcher
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(DarkSurfaceVariant)
                    .padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // Delivery Option
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onMethodToggle(DeliveryMethod.DELIVERY) }
                        .testTag("toggle_delivery"),
                    color = if (deliveryMethod == DeliveryMethod.DELIVERY) NeonLime else Color.Transparent
                ) {
                    Row(
                        modifier = Modifier.padding(vertical = 8.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "🛵 Delivery San Miguel",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (deliveryMethod == DeliveryMethod.DELIVERY) Color(0xFF0C0D12) else TextSecondary
                        )
                    }
                }

                // Take Away Option
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onMethodToggle(DeliveryMethod.TAKE_AWAY) }
                        .testTag("toggle_takeaway"),
                    color = if (deliveryMethod == DeliveryMethod.TAKE_AWAY) NeonPink else Color.Transparent
                ) {
                    Row(
                        modifier = Modifier.padding(vertical = 8.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "🏪 Retiro en Barra (10% OFF)",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (deliveryMethod == DeliveryMethod.TAKE_AWAY) Color.White else TextSecondary
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Current Zone Info Row (Clickable to change)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(DarkBg.copy(alpha = 0.6f))
                    .clickable(onClick = onZoneClick)
                    .padding(horizontal = 12.dp, vertical = 8.dp)
                    .testTag("zone_selector_trigger"),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        imageVector = if (deliveryMethod == DeliveryMethod.DELIVERY) Icons.Default.LocationOn else Icons.Default.Storefront,
                        contentDescription = null,
                        tint = if (deliveryMethod == DeliveryMethod.DELIVERY) NeonLime else NeonPink,
                        modifier = Modifier.size(18.dp)
                    )
                    Column {
                        Text(
                            text = if (deliveryMethod == DeliveryMethod.DELIVERY) {
                                "${currentZone.name} • ${currentZone.estimatedMinutes}"
                            } else {
                                "Barra: ${SanMiguelZones.STORE_ADDRESS}"
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Text(
                            text = if (deliveryMethod == DeliveryMethod.DELIVERY) {
                                "Envío $${currentZone.deliveryFee.toInt()} (Gratis en pedidos > $15.000)"
                            } else {
                                "A 2 cuadras de Plaza San Miguel • Retiro en 10 min"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary
                        )
                    }
                }

                Icon(
                    imageVector = Icons.Default.KeyboardArrowDown,
                    contentDescription = "Cambiar zona",
                    tint = TextSecondary
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SanMiguelZoneBottomSheet(
    selectedZone: DeliveryZone,
    onZoneSelected: (DeliveryZone) -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = DarkSurface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = DarkBorder) }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(text = "📍", fontSize = 24.sp)
                Column {
                    Text(
                        text = "Zonas de Entrega en San Miguel",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                    Text(
                        text = "Seleccioná tu barrio para calcular tiempos y envío",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(SanMiguelZones.ZONES) { zone ->
                    val isSelected = zone.id == selectedZone.id
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .border(
                                BorderStroke(
                                    width = if (isSelected) 1.5.dp else 1.dp,
                                    color = if (isSelected) NeonLime else DarkBorder
                                ),
                                RoundedCornerShape(14.dp)
                            )
                            .clickable {
                                onZoneSelected(zone)
                                onDismiss()
                            }
                            .testTag("zone_option_${zone.id}"),
                        colors = CardDefaults.cardColors(
                            containerColor = if (isSelected) NeonLime.copy(alpha = 0.08f) else DarkSurfaceVariant
                        )
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = zone.name,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isSelected) NeonLime else TextPrimary,
                                    fontSize = 15.sp
                                )
                                Text(
                                    text = zone.description,
                                    color = TextSecondary,
                                    fontSize = 12.sp,
                                    modifier = Modifier.padding(top = 2.dp)
                                )
                                Row(
                                    modifier = Modifier.padding(top = 4.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "⏱️ ${zone.estimatedMinutes}",
                                        fontSize = 11.sp,
                                        color = TextMuted
                                    )
                                    Text(text = "•", fontSize = 11.sp, color = TextMuted)
                                    Text(
                                        text = "🛵 Envío $${zone.deliveryFee.toInt()}",
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = NeonLime
                                    )
                                }
                            }

                            if (isSelected) {
                                Surface(
                                    shape = RoundedCornerShape(50),
                                    color = NeonLime,
                                    modifier = Modifier.size(24.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Check,
                                        contentDescription = null,
                                        tint = Color.Black,
                                        modifier = Modifier.padding(4.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
