package com.example.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.model.*
import com.example.data.remote.ChatMessage
import com.example.data.remote.GeminiBartenderService
import com.example.data.remote.MessageSender
import com.example.data.repository.DrinkRepository
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class MainUiState(
    val drinks: List<Drink> = emptyList(),
    val extraAddons: List<ExtraAddon> = emptyList(),
    val favoriteDrinkIds: Set<String> = emptySet(),
    val selectedDeliveryMethod: DeliveryMethod = DeliveryMethod.DELIVERY,
    val selectedZone: DeliveryZone = SanMiguelZones.ZONES[0],
    val cartItems: List<CartItem> = emptyList(),
    val activeDrinkForDetail: Drink? = null,
    val isZoneSelectorOpen: Boolean = false,
    val currentOrder: Order? = null,
    val orderHistory: List<Order> = emptyList(),
    val userProfile: UserProfile = UserProfile(
        name = "Carlos San Miguel",
        phone = "+54 9 11 5522-3840",
        address = "Av. Pte. Perón 1850, San Miguel",
        selectedZoneId = "sm_centro"
    ),
    val aiMessages: List<ChatMessage> = listOf(
        ChatMessage(
            sender = MessageSender.BARTENDER_AI,
            text = "¡Qué hacés che! 🍸 Soy El Barba, maestro bartender de LitroBar San Miguel. ¿Qué tenés ganas de tomar hoy en vaso de 1 litro para la previa? Preguntame lo que quieras."
        )
    ),
    val isAiLoading: Boolean = false
)

class MainViewModel(
    private val repository: DrinkRepository = DrinkRepository(),
    private val geminiService: GeminiBartenderService = GeminiBartenderService()
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        MainUiState(
            drinks = DrinkRepository.sampleDrinks,
            extraAddons = DrinkRepository.availableAddons
        )
    )
    val uiState: StateFlow<MainUiState> = _uiState.asStateFlow()

    fun openDrinkDetail(drink: Drink) {
        _uiState.update { it.copy(activeDrinkForDetail = drink) }
    }

    fun closeDrinkDetail() {
        _uiState.update { it.copy(activeDrinkForDetail = null) }
    }

    fun openZoneSelector() {
        _uiState.update { it.copy(isZoneSelectorOpen = true) }
    }

    fun closeZoneSelector() {
        _uiState.update { it.copy(isZoneSelectorOpen = false) }
    }

    fun selectZone(zone: DeliveryZone) {
        _uiState.update { it.copy(selectedZone = zone, isZoneSelectorOpen = false) }
    }

    fun setDeliveryMethod(method: DeliveryMethod) {
        _uiState.update { it.copy(selectedDeliveryMethod = method) }
    }

    fun addToCart(item: CartItem) {
        _uiState.update { state ->
            val existingIndex = state.cartItems.indexOfFirst {
                it.drink.id == item.drink.id &&
                        it.size == item.size &&
                        it.intensity == item.intensity &&
                        it.selectedExtras == item.selectedExtras
            }
            val newItems = if (existingIndex >= 0) {
                state.cartItems.toMutableList().apply {
                    val current = this[existingIndex]
                    this[existingIndex] = current.copy(quantity = current.quantity + item.quantity)
                }
            } else {
                state.cartItems + item
            }
            state.copy(cartItems = newItems, activeDrinkForDetail = null)
        }
    }

    fun quickAddDrink(drink: Drink) {
        val item = CartItem(
            drink = drink,
            size = DrinkSize.VASO_1L,
            intensity = AlcoholIntensity.EQUILIBRADO,
            quantity = 1
        )
        addToCart(item)
    }

    fun updateCartItemQuantity(itemId: String, newQty: Int) {
        _uiState.update { state ->
            val updated = state.cartItems.mapNotNull { item ->
                if (item.id == itemId) {
                    if (newQty > 0) item.copy(quantity = newQty) else null
                } else {
                    item
                }
            }
            state.copy(cartItems = updated)
        }
    }

    fun removeCartItem(itemId: String) {
        _uiState.update { state ->
            state.copy(cartItems = state.cartItems.filterNot { it.id == itemId })
        }
    }

    fun clearCart() {
        _uiState.update { it.copy(cartItems = emptyList()) }
    }

    fun toggleFavorite(drink: Drink) {
        _uiState.update { state ->
            val current = state.favoriteDrinkIds
            val updated = if (current.contains(drink.id)) current - drink.id else current + drink.id
            state.copy(favoriteDrinkIds = updated)
        }
    }

    fun placeOrder(order: Order) {
        _uiState.update { state ->
            state.copy(
                currentOrder = order,
                orderHistory = listOf(order) + state.orderHistory,
                cartItems = emptyList()
            )
        }
    }

    fun advanceDemoOrderStep() {
        _uiState.update { state ->
            val current = state.currentOrder ?: return@update state
            val nextStep = when (current.status) {
                OrderStatus.CONFIRMADO -> OrderStatus.PREPARANDO_HIELO
                OrderStatus.PREPARANDO_HIELO -> OrderStatus.EN_CAMINO
                OrderStatus.EN_CAMINO -> OrderStatus.LLEGANDO
                OrderStatus.LLEGANDO -> OrderStatus.ENTREGADO
                OrderStatus.ENTREGADO -> OrderStatus.CONFIRMADO
            }
            state.copy(currentOrder = current.copy(status = nextStep))
        }
    }

    fun updateUserProfile(name: String, phone: String, address: String) {
        _uiState.update { state ->
            state.copy(
                userProfile = state.userProfile.copy(
                    name = name,
                    phone = phone,
                    address = address
                )
            )
        }
    }

    fun sendAiMessage(promptText: String) {
        val userMsg = ChatMessage(sender = MessageSender.USER, text = promptText)
        _uiState.update { it.copy(aiMessages = it.aiMessages + userMsg, isAiLoading = true) }

        viewModelScope.launch {
            val responseText = geminiService.sendMessage(promptText)
            val aiMsg = ChatMessage(sender = MessageSender.BARTENDER_AI, text = responseText)
            _uiState.update { it.copy(aiMessages = it.aiMessages + aiMsg, isAiLoading = false) }
        }
    }

    fun resetAiChat() {
        geminiService.resetChat()
        _uiState.update {
            it.copy(
                aiMessages = listOf(
                    ChatMessage(
                        sender = MessageSender.BARTENDER_AI,
                        text = "¡Mesa limpia! 🧼 Preguntame lo que quieras sobre los tragos de 1 litro de San Miguel."
                    )
                )
            )
        }
    }

    fun selectDrinkByName(drinkName: String) {
        val matched = _uiState.value.drinks.find {
            it.name.contains(drinkName, ignoreCase = true) || drinkName.contains(it.name, ignoreCase = true)
        }
        if (matched != null) {
            openDrinkDetail(matched)
        }
    }
}
