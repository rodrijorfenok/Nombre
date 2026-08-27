package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import com.example.ui.components.SanMiguelZoneBottomSheet
import com.example.ui.screens.ai.BartenderAiScreen
import com.example.ui.screens.cart.CartScreen
import com.example.ui.screens.catalog.CatalogScreen
import com.example.ui.screens.catalog.DrinkDetailSheet
import com.example.ui.screens.custom.Custom1LBuilderScreen
import com.example.ui.screens.profile.ProfileScreen
import com.example.ui.screens.tracking.OrderTrackingScreen
import com.example.ui.theme.*
import com.example.ui.viewmodel.MainViewModel

sealed class Screen(val route: String, val title: String, val iconFilled: ImageVector, val iconOutlined: ImageVector) {
    object Catalog : Screen("catalog", "Tragos 1L", Icons.Filled.LocalBar, Icons.Outlined.LocalBar)
    object Custom : Screen("custom_builder", "Armar 1L", Icons.Filled.Science, Icons.Outlined.Science)
    object BartenderAI : Screen("bartender_ai", "El Barba AI", Icons.Filled.AutoAwesome, Icons.Outlined.AutoAwesome)
    object Cart : Screen("cart", "Pedido", Icons.Filled.ShoppingCart, Icons.Outlined.ShoppingCart)
    object Tracking : Screen("tracking", "En Vivo", Icons.Filled.Moped, Icons.Outlined.Moped)
    object Profile : Screen("profile", "Perfil", Icons.Filled.Person, Icons.Outlined.Person)
}

class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            LitroBarTheme {
                val uiState by viewModel.uiState.collectAsStateWithLifecycle()
                val navController = rememberNavController()

                val items = listOf(
                    Screen.Catalog,
                    Screen.Custom,
                    Screen.BartenderAI,
                    Screen.Cart,
                    Screen.Tracking,
                    Screen.Profile
                )

                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentRoute = navBackStackEntry?.destination?.route ?: Screen.Catalog.route

                Scaffold(
                    modifier = Modifier.fillMaxSize(),
                    containerColor = DarkBg,
                    bottomBar = {
                        NavigationBar(
                            containerColor = DarkSurface,
                            contentColor = TextPrimary,
                            tonalElevation = 8.dp
                        ) {
                            items.forEach { screen ->
                                val isSelected = currentRoute == screen.route
                                val cartCount = uiState.cartItems.sumOf { it.quantity }

                                NavigationBarItem(
                                    icon = {
                                        BadgedBox(
                                            badge = {
                                                if (screen == Screen.Cart && cartCount > 0) {
                                                    Badge(
                                                        containerColor = NeonPink,
                                                        contentColor = Color.White
                                                    ) {
                                                        Text(text = "$cartCount", fontWeight = FontWeight.Bold)
                                                    }
                                                }
                                            }
                                        ) {
                                            Icon(
                                                imageVector = if (isSelected) screen.iconFilled else screen.iconOutlined,
                                                contentDescription = screen.title,
                                                tint = if (isSelected) NeonLime else TextSecondary
                                            )
                                        }
                                    },
                                    label = {
                                        Text(
                                            text = screen.title,
                                            fontSize = 10.sp,
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                            color = if (isSelected) NeonLime else TextSecondary
                                        )
                                    },
                                    selected = isSelected,
                                    onClick = {
                                        if (currentRoute != screen.route) {
                                            navController.navigate(screen.route) {
                                                popUpTo(navController.graph.findStartDestination().id) {
                                                    saveState = true
                                                }
                                                launchSingleTop = true
                                                restoreState = true
                                            }
                                        }
                                    },
                                    colors = NavigationBarItemDefaults.colors(
                                        indicatorColor = NeonLime.copy(alpha = 0.15f)
                                    ),
                                    modifier = Modifier.testTag("nav_item_${screen.route}")
                                )
                            }
                        }
                    }
                ) { innerPadding ->
                    NavHost(
                        navController = navController,
                        startDestination = Screen.Catalog.route,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(innerPadding)
                    ) {
                        composable(Screen.Catalog.route) {
                            CatalogScreen(
                                drinks = uiState.drinks,
                                favoriteIds = uiState.favoriteDrinkIds,
                                currentZone = uiState.selectedZone,
                                deliveryMethod = uiState.selectedDeliveryMethod,
                                onZoneClick = { viewModel.openZoneSelector() },
                                onDeliveryMethodToggle = { viewModel.setDeliveryMethod(it) },
                                onDrinkClick = { viewModel.openDrinkDetail(it) },
                                onQuickAdd = { viewModel.quickAddDrink(it) },
                                onFavoriteToggle = { viewModel.toggleFavorite(it) },
                                onNavigateToCustomBuilder = {
                                    navController.navigate(Screen.Custom.route)
                                },
                                onNavigateToAiBartender = {
                                    navController.navigate(Screen.BartenderAI.route)
                                }
                            )
                        }

                        composable(Screen.Custom.route) {
                            Custom1LBuilderScreen(
                                onAddToCart = { viewModel.addToCart(it) },
                                onNavigateToCart = {
                                    navController.navigate(Screen.Cart.route)
                                }
                            )
                        }

                        composable(Screen.BartenderAI.route) {
                            BartenderAiScreen(
                                messages = uiState.aiMessages,
                                isLoading = uiState.isAiLoading,
                                onSendMessage = { viewModel.sendAiMessage(it) },
                                onResetChat = { viewModel.resetAiChat() },
                                onSelectDrinkByName = { drinkName ->
                                    viewModel.selectDrinkByName(drinkName)
                                }
                            )
                        }

                        composable(Screen.Cart.route) {
                            CartScreen(
                                cartItems = uiState.cartItems,
                                selectedDeliveryMethod = uiState.selectedDeliveryMethod,
                                selectedZone = uiState.selectedZone,
                                userProfile = uiState.userProfile,
                                onDeliveryMethodChange = { viewModel.setDeliveryMethod(it) },
                                onZoneClick = { viewModel.openZoneSelector() },
                                onUpdateQuantity = { id, qty -> viewModel.updateCartItemQuantity(id, qty) },
                                onRemoveItem = { viewModel.removeCartItem(it) },
                                onClearCart = { viewModel.clearCart() },
                                onPlaceOrder = { order ->
                                    viewModel.placeOrder(order)
                                    navController.navigate(Screen.Tracking.route)
                                },
                                onExploreCatalog = {
                                    navController.navigate(Screen.Catalog.route)
                                }
                            )
                        }

                        composable(Screen.Tracking.route) {
                            OrderTrackingScreen(
                                currentOrder = uiState.currentOrder,
                                orderHistory = uiState.orderHistory,
                                onAdvanceDemoStep = { viewModel.advanceDemoOrderStep() }
                            )
                        }

                        composable(Screen.Profile.route) {
                            ProfileScreen(
                                userProfile = uiState.userProfile,
                                favoriteDrinks = uiState.drinks.filter { uiState.favoriteDrinkIds.contains(it.id) },
                                onUpdateProfile = { name, phone, address ->
                                    viewModel.updateUserProfile(name, phone, address)
                                },
                                onSelectDrink = { viewModel.openDrinkDetail(it) }
                            )
                        }
                    }

                    // Active Drink Detail Modal Sheet
                    uiState.activeDrinkForDetail?.let { drink ->
                        DrinkDetailSheet(
                            drink = drink,
                            availableExtras = uiState.extraAddons,
                            onAddToCart = { cartItem ->
                                viewModel.addToCart(cartItem)
                            },
                            onDismiss = { viewModel.closeDrinkDetail() }
                        )
                    }

                    // Zone Selector Modal Sheet
                    if (uiState.isZoneSelectorOpen) {
                        SanMiguelZoneBottomSheet(
                            selectedZone = uiState.selectedZone,
                            onZoneSelected = { viewModel.selectZone(it) },
                            onDismiss = { viewModel.closeZoneSelector() }
                        )
                    }
                }
            }
        }
    }
}
