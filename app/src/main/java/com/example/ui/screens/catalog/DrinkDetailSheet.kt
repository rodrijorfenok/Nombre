package com.example.ui.screens.catalog

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Remove
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DrinkDetailSheet(
    drink: Drink,
    availableExtras: List<ExtraAddon>,
    onAddToCart: (CartItem) -> Unit,
    onDismiss: () -> Unit
) {
    var selectedSize by remember { mutableStateOf(DrinkSize.VASO_1L) }
    var selectedIntensity by remember { mutableStateOf(AlcoholIntensity.EQUILIBRADO) }
    var selectedExtras by remember { mutableStateOf<Set<ExtraAddon>>(emptySet()) }
    var extraIce by remember { mutableStateOf(true) }
    var extraLemon by remember { mutableStateOf(false) }
    var specialNotes by remember { mutableStateOf("") }
    var quantity by remember { mutableIntStateOf(1) }

    val hasLedCup = selectedExtras.any { it.id == "led_cup" }

    val unitPrice = remember(drink, selectedSize, selectedIntensity, selectedExtras, extraLemon) {
        val base = (drink.basePrice * selectedSize.priceMultiplier) + selectedSize.addedPrice + selectedIntensity.priceDelta
        val extrasSum = selectedExtras.sumOf { it.price }
        val lemonPrice = if (extraLemon) 300.0 else 0.0
        base + extrasSum + lemonPrice
    }

    val totalPrice = unitPrice * quantity

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = DarkSurface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = DarkBorder) },
        modifier = Modifier.fillMaxHeight(0.92f)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp)
        ) {
            // Scrollable Content
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
            ) {
                // Header with Name & Close button
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = drink.name,
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Black,
                            color = TextPrimary
                        )
                        Text(
                            text = drink.subtitle,
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextSecondary
                        )
                    }

                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier
                            .background(DarkSurfaceVariant, CircleShape)
                            .size(36.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Cerrar",
                            tint = TextSecondary,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                // Interactive 1L Glass Preview
                Interactive1LGlassView(
                    primaryColor = drink.liquidPrimaryColor,
                    secondaryColor = drink.liquidSecondaryColor,
                    garnishEmoji = drink.garnishEmoji,
                    garnishName = drink.garnishName,
                    drinkSize = selectedSize,
                    intensity = selectedIntensity,
                    hasLedGlow = hasLedCup,
                    hasExtraIce = extraIce,
                    showControls = true
                )

                Spacer(modifier = Modifier.height(18.dp))

                // Ingredients list chips
                Text(
                    text = "INGREDIENTES Y PROPORCIÓN 1L",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextMuted,
                    letterSpacing = 1.sp
                )
                Spacer(modifier = Modifier.height(8.dp))
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(DarkSurfaceVariant)
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    drink.ingredients.forEach { ing ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(text = ing.icon, fontSize = 16.sp)
                                Text(
                                    text = ing.name,
                                    fontSize = 13.sp,
                                    color = TextPrimary,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                            Text(
                                text = ing.quantity,
                                fontSize = 12.sp,
                                color = NeonLime,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(18.dp))

                // Size Selector
                Text(
                    text = "SELECCIONÁ TAMAÑO O FORMATO",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextMuted,
                    letterSpacing = 1.sp
                )
                Spacer(modifier = Modifier.height(8.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    DrinkSize.values().forEach { sizeOption ->
                        val isSelected = selectedSize == sizeOption
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
                                .clickable { selectedSize = sizeOption }
                                .testTag("size_option_${sizeOption.id}"),
                            colors = CardDefaults.cardColors(
                                containerColor = if (isSelected) NeonLime.copy(alpha = 0.1f) else DarkSurfaceVariant
                            )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Text(
                                            text = sizeOption.title,
                                            fontWeight = FontWeight.Bold,
                                            color = if (isSelected) NeonLime else TextPrimary,
                                            fontSize = 14.sp
                                        )
                                        Surface(
                                            color = if (isSelected) NeonLime else DarkBorder,
                                            shape = RoundedCornerShape(6.dp)
                                        ) {
                                            Text(
                                                text = sizeOption.badge,
                                                color = if (isSelected) Color.Black else TextSecondary,
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold,
                                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                            )
                                        }
                                    }
                                    Text(
                                        text = sizeOption.description,
                                        fontSize = 11.sp,
                                        color = TextSecondary,
                                        modifier = Modifier.padding(top = 2.dp)
                                    )
                                }

                                Text(
                                    text = if (sizeOption.addedPrice > 0) "+$${sizeOption.addedPrice.toInt()}" else "Incluido",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 12.sp,
                                    color = if (isSelected) NeonLime else TextMuted
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(18.dp))

                // Alcohol Intensity Selector
                Text(
                    text = "INTENSIDAD Y GRADUACIÓN ALCOHÓLICA",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextMuted,
                    letterSpacing = 1.sp
                )
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    AlcoholIntensity.values().forEach { intensityOpt ->
                        val isSelected = selectedIntensity == intensityOpt
                        Card(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(12.dp))
                                .border(
                                    BorderStroke(
                                        width = if (isSelected) 1.5.dp else 1.dp,
                                        color = if (isSelected) NeonPink else DarkBorder
                                    ),
                                    RoundedCornerShape(12.dp)
                                )
                                .clickable { selectedIntensity = intensityOpt }
                                .testTag("intensity_${intensityOpt.name}"),
                            colors = CardDefaults.cardColors(
                                containerColor = if (isSelected) NeonPink.copy(alpha = 0.12f) else DarkSurfaceVariant
                            )
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(8.dp),
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                Text(text = intensityOpt.icon, fontSize = 20.sp)
                                Text(
                                    text = intensityOpt.label,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isSelected) NeonPinkLight else TextPrimary,
                                    maxLines = 1
                                )
                                if (intensityOpt.priceDelta > 0) {
                                    Text(
                                        text = "+$${intensityOpt.priceDelta.toInt()}",
                                        fontSize = 10.sp,
                                        color = NeonPink,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(18.dp))

                // Extras & Addons
                Text(
                    text = "EXTRAS Y ACCESORIOS PARA LA FIESTA",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextMuted,
                    letterSpacing = 1.sp
                )
                Spacer(modifier = Modifier.height(8.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    availableExtras.forEach { addon ->
                        val isAdded = selectedExtras.contains(addon)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(DarkSurfaceVariant)
                                .clickable {
                                    selectedExtras = if (isAdded) {
                                        selectedExtras - addon
                                    } else {
                                        selectedExtras + addon
                                    }
                                }
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(text = addon.iconEmoji, fontSize = 20.sp)
                                Column {
                                    Text(
                                        text = addon.name,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = TextPrimary
                                    )
                                    Text(
                                        text = addon.description,
                                        fontSize = 11.sp,
                                        color = TextSecondary
                                    )
                                }
                            }

                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(
                                    text = "+$${addon.price.toInt()}",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = NeonLime
                                )
                                Checkbox(
                                    checked = isAdded,
                                    onCheckedChange = { checked ->
                                        selectedExtras = if (checked) selectedExtras + addon else selectedExtras - addon
                                    },
                                    colors = CheckboxDefaults.colors(
                                        checkedColor = NeonLime,
                                        checkmarkColor = Color.Black
                                    )
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(18.dp))

                // Special Instructions Notes
                OutlinedTextField(
                    value = specialNotes,
                    onValueChange = { specialNotes = it },
                    label = { Text("Instrucciones o pedido especial a la barra") },
                    placeholder = { Text("Ej. Sin sorbete, hielo en bolsa aparte, etc.") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("special_notes_input"),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = NeonLime,
                        unfocusedBorderColor = DarkBorder,
                        focusedLabelColor = NeonLime,
                        unfocusedContainerColor = DarkSurfaceVariant,
                        focusedContainerColor = DarkSurfaceVariant
                    ),
                    shape = RoundedCornerShape(12.dp),
                    maxLines = 2
                )

                Spacer(modifier = Modifier.height(24.dp))
            }

            // Bottom Sticky Bar (Quantity & Add Button)
            HorizontalDivider(color = DarkBorder)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Quantity Selector
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(DarkSurfaceVariant)
                        .border(1.dp, DarkBorder, RoundedCornerShape(14.dp))
                        .padding(horizontal = 4.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = { if (quantity > 1) quantity-- },
                        modifier = Modifier.size(36.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Remove,
                            contentDescription = "Restar",
                            tint = TextPrimary
                        )
                    }

                    Text(
                        text = "$quantity",
                        fontWeight = FontWeight.Black,
                        fontSize = 16.sp,
                        color = TextPrimary,
                        modifier = Modifier.padding(horizontal = 8.dp)
                    )

                    IconButton(
                        onClick = { quantity++ },
                        modifier = Modifier.size(36.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = "Sumar",
                            tint = NeonLime
                        )
                    }
                }

                // Add to Cart CTA Button
                Button(
                    onClick = {
                        val item = CartItem(
                            drink = drink,
                            size = selectedSize,
                            intensity = selectedIntensity,
                            selectedExtras = selectedExtras.toList(),
                            extraIce = extraIce,
                            extraLemon = extraLemon,
                            specialNotes = specialNotes,
                            quantity = quantity
                        )
                        onAddToCart(item)
                    },
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                        .testTag("add_to_cart_confirm_button"),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = NeonLime,
                        contentColor = Color(0xFF0C0D12)
                    )
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Agregar al Pedido",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.ExtraBold
                        )
                        Text(
                            text = "$${totalPrice.toInt()}",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Black
                        )
                    }
                }
            }
        }
    }
}
