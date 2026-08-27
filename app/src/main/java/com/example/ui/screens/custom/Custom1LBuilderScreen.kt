package com.example.ui.screens.custom

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.*
import com.example.ui.components.Interactive1LGlassView
import com.example.ui.theme.*

data class SpiritOption(
    val name: String,
    val brand: String,
    val icon: String,
    val color: Color,
    val basePrice: Double
)

data class MixerOption(
    val name: String,
    val icon: String,
    val color: Color,
    val addedPrice: Double
)

data class GarnishOption(
    val name: String,
    val emoji: String,
    val price: Double
)

@Composable
fun Custom1LBuilderScreen(
    onAddToCart: (CartItem) -> Unit,
    onNavigateToCart: () -> Unit,
    modifier: Modifier = Modifier
) {
    val spirits = remember {
        listOf(
            SpiritOption("Fernet Branca", "El Clásico Cordobés", "🦅", Color(0xFF1E110A), 4800.0),
            SpiritOption("Gin London Dry", "Botánico & Aromático", "🍸", Color(0xFFB8E63C), 4600.0),
            SpiritOption("Vodka Smirnoff", "Triple Destilado", "⚡", Color(0xFF05D9E8), 4500.0),
            SpiritOption("Ron Havana Club", "Dorado Especial", "🥃", Color(0xFFFFA000), 4600.0),
            SpiritOption("Campari Milano", "Bitter Rojo Intenso", "🍊", Color(0xFFFF2A6D), 4400.0),
            SpiritOption("Aperol", "Naranja Cítrico & Dulce", "🍹", Color(0xFFFF5722), 4700.0),
            SpiritOption("Tequila Gold", "Agave Azul", "🌵", Color(0xFFFFD54F), 5000.0)
        )
    }

    val mixers = remember {
        listOf(
            MixerOption("Coca-Cola Helada", "🫧", Color(0xFF2C1608), 0.0),
            MixerOption("Agua Tónica Premium", "🫧", Color(0xFFCEFA58), 300.0),
            MixerOption("Speed Unlimited Energy", "⚡", Color(0xFFFF9F1C), 500.0),
            MixerOption("Sprite Limón-Lima", "🍋", Color(0xFF00E676), 200.0),
            MixerOption("Jugo Naranja Exprimido", "🍊", Color(0xFFFF6D00), 400.0),
            MixerOption("Pomelo Paso de los Toros", "🍈", Color(0xFFFFB74D), 200.0),
            MixerOption("Red Bull Energy Drink", "🐂", Color(0xFF00B0FF), 800.0)
        )
    }

    val garnishes = remember {
        listOf(
            GarnishOption("Rodajas de Limón", "🍋", 0.0),
            GarnishOption("Pepino & Enebro", "🥒", 200.0),
            GarnishOption("Pomelo Rosado", "🍊", 200.0),
            GarnishOption("Menta Fresca", "🌿", 200.0),
            GarnishOption("Frutos Rojos", "🍓", 400.0),
            GarnishOption("Brocheta Gomitas", "🍬", 450.0)
        )
    }

    var selectedSpirit by remember { mutableStateOf(spirits[0]) }
    var selectedMixer by remember { mutableStateOf(mixers[0]) }
    var selectedGarnish by remember { mutableStateOf(garnishes[0]) }
    var selectedSize by remember { mutableStateOf(DrinkSize.VASO_1L) }
    var selectedIntensity by remember { mutableStateOf(AlcoholIntensity.EQUILIBRADO) }
    var customDrinkName by remember { mutableStateOf("") }
    var hasLedGlow by remember { mutableStateOf(false) }

    val liquidPrimary by animateColorAsState(selectedSpirit.color, label = "spirit_col")
    val liquidSecondary by animateColorAsState(selectedMixer.color, label = "mixer_col")

    val unitPrice = remember(selectedSpirit, selectedMixer, selectedGarnish, selectedSize, selectedIntensity, hasLedGlow) {
        val base = (selectedSpirit.basePrice * selectedSize.priceMultiplier) + selectedSize.addedPrice + selectedIntensity.priceDelta
        val mixerCost = selectedMixer.addedPrice
        val garnishCost = selectedGarnish.price
        val ledCost = if (hasLedGlow) 950.0 else 0.0
        base + mixerCost + garnishCost + ledCost
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBg)
    ) {
        // Top Header
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(DarkSurface)
                .padding(horizontal = 20.dp, vertical = 14.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.AutoAwesome,
                        contentDescription = null,
                        tint = NeonLime,
                        modifier = Modifier.size(24.dp)
                    )
                    Text(
                        text = "Laboratorio 1 Litro",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Black,
                        color = TextPrimary
                    )
                }

                Surface(
                    color = NeonPink.copy(alpha = 0.2f),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text(
                        text = "100% Personalizado",
                        color = NeonPinkLight,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
            Text(
                text = "Elegí tu destilado, mixer, proporción y garnish. Creá tu propio 1L único.",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                modifier = Modifier.padding(top = 4.dp)
            )
        }

        // Scrollable Body
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            // Live Interactive 1L Glass Visualizer
            Interactive1LGlassView(
                primaryColor = liquidPrimary,
                secondaryColor = liquidSecondary,
                garnishEmoji = selectedGarnish.emoji,
                garnishName = selectedGarnish.name,
                drinkSize = selectedSize,
                intensity = selectedIntensity,
                hasLedGlow = hasLedGlow,
                showControls = true
            )

            // Step 1: Base Spirit
            SectionHeader(stepNumber = "1", title = "ELEGÍ TU BASE DE ALCOHOL")
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(spirits) { spirit ->
                    val isSelected = selectedSpirit == spirit
                    Card(
                        modifier = Modifier
                            .width(130.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .border(
                                BorderStroke(
                                    width = if (isSelected) 2.dp else 1.dp,
                                    color = if (isSelected) NeonLime else DarkBorder
                                ),
                                RoundedCornerShape(14.dp)
                            )
                            .clickable { selectedSpirit = spirit }
                            .testTag("spirit_${spirit.name}"),
                        colors = CardDefaults.cardColors(
                            containerColor = if (isSelected) NeonLime.copy(alpha = 0.12f) else DarkSurface
                        )
                    ) {
                        Column(
                            modifier = Modifier.padding(10.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(text = spirit.icon, fontSize = 28.sp)
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = spirit.name,
                                fontWeight = FontWeight.Bold,
                                fontSize = 12.sp,
                                color = if (isSelected) NeonLime else TextPrimary,
                                maxLines = 1
                            )
                            Text(
                                text = spirit.brand,
                                fontSize = 10.sp,
                                color = TextSecondary,
                                maxLines = 1
                            )
                            Text(
                                text = "$${spirit.basePrice.toInt()}",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = NeonLime,
                                modifier = Modifier.padding(top = 4.dp)
                            )
                        }
                    }
                }
            }

            // Step 2: Mixer
            SectionHeader(stepNumber = "2", title = "ELEGÍ TU MIXER / GASEOSA / SPEED")
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(mixers) { mixer ->
                    val isSelected = selectedMixer == mixer
                    Card(
                        modifier = Modifier
                            .width(140.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .border(
                                BorderStroke(
                                    width = if (isSelected) 2.dp else 1.dp,
                                    color = if (isSelected) NeonPink else DarkBorder
                                ),
                                RoundedCornerShape(14.dp)
                            )
                            .clickable { selectedMixer = mixer }
                            .testTag("mixer_${mixer.name}"),
                        colors = CardDefaults.cardColors(
                            containerColor = if (isSelected) NeonPink.copy(alpha = 0.12f) else DarkSurface
                        )
                    ) {
                        Column(
                            modifier = Modifier.padding(10.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(text = mixer.icon, fontSize = 26.sp)
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = mixer.name,
                                fontWeight = FontWeight.Bold,
                                fontSize = 11.sp,
                                color = if (isSelected) NeonPinkLight else TextPrimary,
                                maxLines = 1
                            )
                            Text(
                                text = if (mixer.addedPrice > 0) "+$${mixer.addedPrice.toInt()}" else "Sin cargo",
                                fontSize = 10.sp,
                                color = if (isSelected) NeonPink else TextMuted,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(top = 2.dp)
                            )
                        }
                    }
                }
            }

            // Step 3: Garnish & Decoración
            SectionHeader(stepNumber = "3", title = "GARNISH Y FRUTAS")
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(garnishes) { garnish ->
                    val isSelected = selectedGarnish == garnish
                    Card(
                        modifier = Modifier
                            .width(120.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .border(
                                BorderStroke(
                                    width = if (isSelected) 1.5.dp else 1.dp,
                                    color = if (isSelected) NeonCyan else DarkBorder
                                ),
                                RoundedCornerShape(14.dp)
                            )
                            .clickable { selectedGarnish = garnish }
                            .testTag("garnish_${garnish.name}"),
                        colors = CardDefaults.cardColors(
                            containerColor = if (isSelected) NeonCyan.copy(alpha = 0.12f) else DarkSurface
                        )
                    ) {
                        Column(
                            modifier = Modifier.padding(8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(text = garnish.emoji, fontSize = 24.sp)
                            Text(
                                text = garnish.name,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 11.sp,
                                color = TextPrimary,
                                maxLines = 1
                            )
                            Text(
                                text = if (garnish.price > 0) "+$${garnish.price.toInt()}" else "Gratis",
                                fontSize = 10.sp,
                                color = if (isSelected) NeonCyan else TextMuted
                            )
                        }
                    }
                }
            }

            // Step 4: Size & Intensity
            SectionHeader(stepNumber = "4", title = "FORMATO Y GRADUACIÓN")
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                DrinkSize.values().forEach { sizeOpt ->
                    val isSelected = selectedSize == sizeOpt
                    Card(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(12.dp))
                            .border(
                                BorderStroke(
                                    width = if (isSelected) 1.5.dp else 1.dp,
                                    color = if (isSelected) NeonLime else DarkBorder
                                ),
                                RoundedCornerShape(12.dp)
                            )
                            .clickable { selectedSize = sizeOpt },
                        colors = CardDefaults.cardColors(
                            containerColor = if (isSelected) NeonLime.copy(alpha = 0.12f) else DarkSurface
                        )
                    ) {
                        Column(
                            modifier = Modifier.padding(8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                text = sizeOpt.title,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (isSelected) NeonLime else TextPrimary,
                                maxLines = 1
                            )
                            Text(
                                text = sizeOpt.volumeLabel,
                                fontSize = 10.sp,
                                color = TextSecondary
                            )
                        }
                    }
                }
            }

            // Custom Name for the Creation
            OutlinedTextField(
                value = customDrinkName,
                onValueChange = { customDrinkName = it },
                label = { Text("Bautizá tu creación de 1L (Opcional)") },
                placeholder = { Text("Ej. El Misil de Muñiz, Jarra Nocturna, etc.") },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("custom_drink_name_input"),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = NeonLime,
                    unfocusedBorderColor = DarkBorder,
                    focusedLabelColor = NeonLime,
                    unfocusedContainerColor = DarkSurface,
                    focusedContainerColor = DarkSurface
                ),
                shape = RoundedCornerShape(12.dp),
                singleLine = true
            )
        }

        // Bottom Add CTA
        HorizontalDivider(color = DarkBorder)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DarkSurface)
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "TOTAL 1 LITRO",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextMuted
                )
                Text(
                    text = "$${unitPrice.toInt()}",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Black,
                    color = NeonLime
                )
            }

            Button(
                onClick = {
                    val finalName = if (customDrinkName.isNotBlank()) customDrinkName.trim() else "Custom 1L: ${selectedSpirit.name} + ${selectedMixer.name}"
                    val customDrink = Drink(
                        id = "custom_${System.currentTimeMillis()}",
                        name = finalName,
                        subtitle = "${selectedSpirit.name} con ${selectedMixer.name}",
                        description = "Trago exclusivo creado por el usuario con ${selectedSpirit.name}, ${selectedMixer.name} y garnish de ${selectedGarnish.name}.",
                        basePrice = selectedSpirit.basePrice,
                        category = DrinkCategory.JARRAS_ESPECIALES,
                        alcoholPercentage = "A elección",
                        liquidPrimaryColor = selectedSpirit.color,
                        liquidSecondaryColor = selectedMixer.color,
                        garnishEmoji = selectedGarnish.emoji,
                        garnishName = selectedGarnish.name,
                        ingredients = listOf(
                            Ingredient(selectedSpirit.name, "300 ml", selectedSpirit.icon),
                            Ingredient(selectedMixer.name, "700 ml", selectedMixer.icon),
                            Ingredient(selectedGarnish.name, "1 dosis", selectedGarnish.emoji)
                        ),
                        tags = listOf("Personalizado", "Vaso 1L Único"),
                        popularityScore = 5.0f,
                        isSignature1L = true
                    )
                    val cartItem = CartItem(
                        drink = customDrink,
                        size = selectedSize,
                        intensity = selectedIntensity,
                        selectedExtras = if (hasLedGlow) listOf(
                            ExtraAddon("led_cup", "Vaso Neón LED", 950.0, "💡", "Vaso 1L luminoso")
                        ) else emptyList(),
                        quantity = 1
                    )
                    onAddToCart(cartItem)
                    onNavigateToCart()
                },
                modifier = Modifier
                    .weight(2f)
                    .height(52.dp)
                    .testTag("add_custom_drink_button"),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = NeonLime,
                    contentColor = Color(0xFF0C0D12)
                )
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(imageVector = Icons.Default.ShoppingCart, contentDescription = null)
                    Text(
                        text = "Agregar al Carrito",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Black
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(stepNumber: String, title: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Surface(
            shape = RoundedCornerShape(50),
            color = NeonLime,
            modifier = Modifier.size(20.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    text = stepNumber,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Black,
                    color = Color.Black
                )
            }
        }
        Text(
            text = title,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = TextMuted,
            letterSpacing = 0.5.sp
        )
    }
}
