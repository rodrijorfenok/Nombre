package com.example.ui.screens.catalog

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.R
import com.example.data.model.*
import com.example.ui.components.DrinkCard
import com.example.ui.components.SanMiguelZoneBanner
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogScreen(
    drinks: List<Drink>,
    favoriteIds: Set<String>,
    currentZone: DeliveryZone,
    deliveryMethod: DeliveryMethod,
    onZoneClick: () -> Unit,
    onDeliveryMethodToggle: (DeliveryMethod) -> Unit,
    onDrinkClick: (Drink) -> Unit,
    onQuickAdd: (Drink) -> Unit,
    onFavoriteToggle: (Drink) -> Unit,
    onNavigateToCustomBuilder: () -> Unit,
    onNavigateToAiBartender: () -> Unit,
    modifier: Modifier = Modifier
) {
    var searchQuery by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf(DrinkCategory.TODOS) }

    val filteredDrinks = remember(drinks, searchQuery, selectedCategory) {
        drinks.filter { drink ->
            val matchesQuery = searchQuery.isBlank() ||
                    drink.name.contains(searchQuery, ignoreCase = true) ||
                    drink.subtitle.contains(searchQuery, ignoreCase = true) ||
                    drink.ingredients.any { it.name.contains(searchQuery, ignoreCase = true) }

            val matchesCategory = selectedCategory == DrinkCategory.TODOS || drink.category == selectedCategory
            matchesQuery && matchesCategory
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBg)
    ) {
        // App Top Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DarkSurface)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Surface(
                    color = NeonLime,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.size(36.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(text = "1L", fontSize = 16.sp, fontWeight = FontWeight.Black, color = Color(0xFF0C0D12))
                    }
                }
                Column {
                    Text(
                        text = "LitroBar San Miguel",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Black,
                        color = TextPrimary
                    )
                    Text(
                        text = "Tragos Gigantes de 1 Litro • Delivery",
                        style = MaterialTheme.typography.bodySmall,
                        color = NeonLimeLight,
                        fontSize = 11.sp
                    )
                }
            }

            // AI Bartender Quick Action
            Surface(
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .clickable(onClick = onNavigateToAiBartender)
                    .testTag("bartender_ai_trigger"),
                color = NeonPink.copy(alpha = 0.15f),
                border = BorderStroke(1.dp, NeonPink.copy(alpha = 0.5f))
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(text = "🧔🏻‍♂️", fontSize = 14.sp)
                    Text(
                        text = "Bartender AI",
                        color = NeonPinkLight,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        HorizontalDivider(color = DarkBorder)

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 16.dp),
            contentPadding = PaddingValues(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // Zone & Delivery / Take Away Switcher
            item {
                SanMiguelZoneBanner(
                    currentZone = currentZone,
                    deliveryMethod = deliveryMethod,
                    onZoneClick = onZoneClick,
                    onMethodToggle = onDeliveryMethodToggle
                )
            }

            // Hero Nightlife Banner
            item {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(130.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .border(1.dp, DarkBorder, RoundedCornerShape(18.dp)),
                    colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant)
                ) {
                    Box(modifier = Modifier.fillMaxSize()) {
                        Image(
                            painter = painterResource(id = R.drawable.hero_cocktails_banner_1787869068176),
                            contentDescription = "LitroBar Banner",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize()
                        )

                        // Dark gradient overlay for text readability
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(
                                    Brush.horizontalGradient(
                                        listOf(
                                            Color.Black.copy(alpha = 0.85f),
                                            Color.Black.copy(alpha = 0.4f),
                                            Color.Transparent
                                        )
                                    )
                                )
                        )

                        Column(
                            modifier = Modifier
                                .fillMaxHeight()
                                .padding(16.dp),
                            verticalArrangement = Arrangement.Center
                        ) {
                            Surface(
                                color = NeonLime,
                                shape = RoundedCornerShape(6.dp)
                            ) {
                                Text(
                                    text = "VASOS DE 1 LITRO",
                                    color = Color.Black,
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Black,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = "La Previa Arranca Acá",
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Black,
                                color = Color.White
                            )
                            Text(
                                text = "Hielo macizo • Vasos térmicos • Delivery San Miguel",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextSecondary
                            )
                        }
                    }
                }
            }

            // Custom Drink Builder Promo Banner
            item {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .border(1.dp, NeonLime.copy(alpha = 0.4f), RoundedCornerShape(16.dp))
                        .clickable(onClick = onNavigateToCustomBuilder)
                        .testTag("custom_builder_banner"),
                    colors = CardDefaults.cardColors(
                        containerColor = DarkSurfaceVariant
                    )
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
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Surface(
                                color = NeonLime.copy(alpha = 0.2f),
                                shape = CircleShape,
                                modifier = Modifier.size(42.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(text = "🧪", fontSize = 22.sp)
                                }
                            }
                            Column {
                                Text(
                                    text = "Laboratorio: Armá tu Vaso 1L",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                    color = TextPrimary
                                )
                                Text(
                                    text = "Elegí alcohol, gaseosa, garnish y hielo",
                                    fontSize = 11.sp,
                                    color = TextSecondary
                                )
                            }
                        }

                        Icon(
                            imageVector = Icons.Default.ArrowForward,
                            contentDescription = "Crear",
                            tint = NeonLime
                        )
                    }
                }
            }

            // Search Bar
            item {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("Buscar trago de 1L (Fernet, Gin, Speed...)") },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Search,
                            contentDescription = null,
                            tint = TextSecondary
                        )
                    },
                    trailingIcon = {
                        if (searchQuery.isNotBlank()) {
                            IconButton(onClick = { searchQuery = "" }) {
                                Icon(imageVector = Icons.Default.Close, contentDescription = "Limpiar", tint = TextMuted)
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("catalog_search_bar"),
                    shape = RoundedCornerShape(14.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = NeonLime,
                        unfocusedBorderColor = DarkBorder,
                        focusedContainerColor = DarkSurface,
                        unfocusedContainerColor = DarkSurface,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary
                    ),
                    singleLine = true
                )
            }

            // Category Filter Chips
            item {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    items(DrinkCategory.values()) { category ->
                        val isSelected = selectedCategory == category
                        FilterChip(
                            selected = isSelected,
                            onClick = { selectedCategory = category },
                            label = {
                                Text(
                                    text = "${category.iconEmoji} ${category.displayName}",
                                    fontSize = 12.sp,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium
                                )
                            },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = NeonLime,
                                selectedLabelColor = Color(0xFF0C0D12),
                                containerColor = DarkSurface,
                                labelColor = TextSecondary
                            ),
                            border = FilterChipDefaults.filterChipBorder(
                                enabled = true,
                                selected = isSelected,
                                borderColor = DarkBorder,
                                selectedBorderColor = NeonLime
                            ),
                            shape = RoundedCornerShape(12.dp)
                        )
                    }
                }
            }

            // List of Drinks
            if (filteredDrinks.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(text = "🔍", fontSize = 36.sp)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "No se encontraron tragos de 1L",
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Text(
                            text = "Probá buscando por otro nombre o categoría.",
                            color = TextSecondary,
                            fontSize = 12.sp
                        )
                    }
                }
            } else {
                items(filteredDrinks, key = { it.id }) { drink ->
                    DrinkCard(
                        drink = drink,
                        isFavorite = favoriteIds.contains(drink.id),
                        onFavoriteToggle = { onFavoriteToggle(drink) },
                        onClick = { onDrinkClick(drink) },
                        onQuickAdd = { onQuickAdd(drink) }
                    )
                }
            }
        }
    }
}
