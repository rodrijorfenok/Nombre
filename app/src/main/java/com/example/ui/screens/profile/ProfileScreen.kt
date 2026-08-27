package com.example.ui.screens.profile

import android.content.Intent
import android.net.Uri
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.Drink
import com.example.data.model.SanMiguelZones
import com.example.data.model.UserProfile
import com.example.ui.theme.*

@Composable
fun ProfileScreen(
    userProfile: UserProfile,
    favoriteDrinks: List<Drink>,
    onUpdateProfile: (String, String, String) -> Unit,
    onSelectDrink: (Drink) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current

    var name by remember(userProfile.name) { mutableStateOf(userProfile.name) }
    var phone by remember(userProfile.phone) { mutableStateOf(userProfile.phone) }
    var address by remember(userProfile.address) { mutableStateOf(userProfile.address) }
    var isEditing by remember { mutableStateOf(false) }

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
                    imageVector = Icons.Default.Person,
                    contentDescription = null,
                    tint = NeonLime,
                    modifier = Modifier.size(24.dp)
                )
                Text(
                    text = "Mi Perfil LitroBar",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Black,
                    color = TextPrimary
                )
            }

            TextButton(
                onClick = {
                    if (isEditing) {
                        onUpdateProfile(name, phone, address)
                    }
                    isEditing = !isEditing
                }
            ) {
                Text(
                    text = if (isEditing) "Guardar" else "Editar",
                    color = NeonLime,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        HorizontalDivider(color = DarkBorder)

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // User Avatar Card
            item {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(20.dp))
                        .border(1.dp, DarkBorder, RoundedCornerShape(20.dp)),
                    colors = CardDefaults.cardColors(containerColor = DarkSurface)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box(
                            modifier = Modifier
                                .size(64.dp)
                                .clip(CircleShape)
                                .background(NeonLime.copy(alpha = 0.15f))
                                .border(2.dp, NeonLime, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(text = "🍸", fontSize = 32.sp)
                        }

                        Spacer(modifier = Modifier.height(10.dp))
                        Text(
                            text = if (name.isNotBlank()) name else "Amante de los 1L",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Black,
                            color = TextPrimary
                        )
                        Text(
                            text = if (phone.isNotBlank()) phone else "San Miguel, Buenos Aires",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary
                        )
                    }
                }
            }

            // User Info Fields
            item {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .border(1.dp, DarkBorder, RoundedCornerShape(16.dp)),
                    colors = CardDefaults.cardColors(containerColor = DarkSurface)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "TUS DATOS DE ENTREGA",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextMuted,
                            letterSpacing = 1.sp
                        )

                        if (isEditing) {
                            OutlinedTextField(
                                value = name,
                                onValueChange = { name = it },
                                label = { Text("Nombre y Apellido") },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = NeonLime,
                                    unfocusedBorderColor = DarkBorder,
                                    focusedContainerColor = DarkSurfaceVariant,
                                    unfocusedContainerColor = DarkSurfaceVariant
                                )
                            )
                            OutlinedTextField(
                                value = phone,
                                onValueChange = { phone = it },
                                label = { Text("Teléfono / WhatsApp") },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = NeonLime,
                                    unfocusedBorderColor = DarkBorder,
                                    focusedContainerColor = DarkSurfaceVariant,
                                    unfocusedContainerColor = DarkSurfaceVariant
                                )
                            )
                            OutlinedTextField(
                                value = address,
                                onValueChange = { address = it },
                                label = { Text("Dirección habitual (San Miguel)") },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = NeonLime,
                                    unfocusedBorderColor = DarkBorder,
                                    focusedContainerColor = DarkSurfaceVariant,
                                    unfocusedContainerColor = DarkSurfaceVariant
                                )
                            )
                        } else {
                            InfoRow(icon = "👤", label = "Nombre", value = if (name.isNotBlank()) name else "No especificado")
                            InfoRow(icon = "📞", label = "WhatsApp", value = if (phone.isNotBlank()) phone else "No especificado")
                            InfoRow(icon = "🏠", label = "Dirección", value = if (address.isNotBlank()) address else "No especificada")
                        }
                    }
                }
            }

            // Favorites List
            if (favoriteDrinks.isNotEmpty()) {
                item {
                    Text(
                        text = "TUS TRAGOS DE 1L FAVORITOS",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextMuted,
                        letterSpacing = 1.sp
                    )
                }

                items(favoriteDrinks) { favDrink ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .border(1.dp, DarkBorder, RoundedCornerShape(14.dp))
                            .clickable { onSelectDrink(favDrink) },
                        colors = CardDefaults.cardColors(containerColor = DarkSurface)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Text(text = favDrink.garnishEmoji, fontSize = 24.sp)
                                Column {
                                    Text(
                                        text = favDrink.name,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 13.sp,
                                        color = TextPrimary
                                    )
                                    Text(
                                        text = "$${favDrink.basePrice.toInt()} • 1L XL",
                                        fontSize = 11.sp,
                                        color = NeonLime
                                    )
                                }
                            }
                            Text(
                                text = "Pedir >",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = NeonPink
                            )
                        }
                    }
                }
            }

            // Bar Location & Info
            item {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .border(1.dp, DarkBorder, RoundedCornerShape(16.dp)),
                    colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(text = "🏪", fontSize = 20.sp)
                            Text(
                                text = "LitroBar Central San Miguel",
                                fontWeight = FontWeight.Black,
                                fontSize = 14.sp,
                                color = TextPrimary
                            )
                        }

                        Text(
                            text = "📍 Ubicación: ${SanMiguelZones.STORE_ADDRESS} (A 2 cuadras de Plaza San Miguel)",
                            fontSize = 12.sp,
                            color = TextSecondary
                        )

                        Text(
                            text = "⏰ Horarios: Miércoles a Domingo de 19:00 a 05:30 hs",
                            fontSize = 12.sp,
                            color = TextSecondary
                        )

                        Text(
                            text = "❄️ Compromiso Frío 1L: Todos nuestros envíos salen en cajas térmicas con hielo roca recién picado para garantizar máxima frescura.",
                            fontSize = 11.sp,
                            color = NeonLimeLight
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoRow(icon: String, label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(text = icon, fontSize = 14.sp)
            Text(text = label, fontSize = 12.sp, color = TextSecondary)
        }
        Text(
            text = value,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            color = TextPrimary
        )
    }
}
