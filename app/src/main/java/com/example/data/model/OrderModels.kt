package com.example.data.model

import java.util.UUID

data class CartItem(
    val id: String = UUID.randomUUID().toString(),
    val drink: Drink,
    val size: DrinkSize = DrinkSize.VASO_1L,
    val intensity: AlcoholIntensity = AlcoholIntensity.EQUILIBRADO,
    val selectedExtras: List<ExtraAddon> = emptyList(),
    val extraIce: Boolean = true,
    val extraLemon: Boolean = false,
    val specialNotes: String = "",
    val quantity: Int = 1
) {
    val unitPrice: Double
        get() {
            val base = (drink.basePrice * size.priceMultiplier) + size.addedPrice + intensity.priceDelta
            val extrasSum = selectedExtras.sumOf { it.price }
            val garnishExtras = (if (extraLemon) 300.0 else 0.0)
            return base + extrasSum + garnishExtras
        }

    val totalPrice: Double
        get() = unitPrice * quantity
}

enum class DeliveryMethod(val title: String, val subtitle: String, val iconEmoji: String) {
    DELIVERY("Envío a Domicilio", "Moto térmica directa en San Miguel", "🛵"),
    TAKE_AWAY("Take Away / Retiro en Barra", "Belgrano 1450, San Miguel (10% OFF)", "🏪")
}

enum class PaymentMethod(val title: String, val detail: String, val iconEmoji: String) {
    EFECTIVO("Efectivo al recibir", "Abonás al repartidor o en barra", "💵"),
    MERCADO_PAGO_TRANSFERENCIA("Mercado Pago / Transferencia", "Alias: LITROBAR.SM (Envío comprobante)", "📱"),
    TARJETA_POSNET("Tarjeta Débito/Crédito", "Posnet inalámbrico en domicilio", "💳")
}

data class DeliveryZone(
    val id: String,
    val name: String,
    val estimatedMinutes: String,
    val deliveryFee: Double,
    val minOrderForFreeDelivery: Double = 15000.0,
    val description: String
)

object SanMiguelZones {
    val ZONES = listOf(
        DeliveryZone(
            id = "sm_centro",
            name = "San Miguel Centro",
            estimatedMinutes = "15 - 25 min",
            deliveryFee = 700.0,
            description = "Plaza San Miguel, Av. Pte. Perón, Calle Belgrano, Av. Mitre"
        ),
        DeliveryZone(
            id = "sm_muniz",
            name = "Muñiz",
            estimatedMinutes = "20 - 30 min",
            deliveryFee = 800.0,
            description = "Av. San Martín, Azcuénaga, Estación Muñiz, Corredor Aeróbico"
        ),
        DeliveryZone(
            id = "sm_bellavista",
            name = "Bella Vista",
            estimatedMinutes = "25 - 35 min",
            deliveryFee = 900.0,
            description = "Av. Francia, Senador Morón, Gaspar Campos, Club Regatas"
        ),
        DeliveryZone(
            id = "sm_lemos",
            name = "Gral. Lemos / Los Polvorines",
            estimatedMinutes = "25 - 40 min",
            deliveryFee = 950.0,
            description = "Estación Lemos, Ruta 202, Terrazas de Mayo"
        ),
        DeliveryZone(
            id = "sm_mattaldi",
            name = "Mattaldi / Campo de Mayo",
            estimatedMinutes = "20 - 35 min",
            deliveryFee = 850.0,
            description = "Zona Hospital Larcade, Mattaldi, Puerta 4"
        ),
        DeliveryZone(
            id = "sm_santamaria",
            name = "Santa María / Trujui",
            estimatedMinutes = "30 - 45 min",
            deliveryFee = 1100.0,
            description = "Av. Balbín hacia Río Reconquista, Trujui"
        )
    )

    val STORE_COORDINATES = Pair(-34.5422, -58.7131) // Centro de San Miguel (Belgrano y Perón)
    const val STORE_ADDRESS = "Belgrano 1450, San Miguel, Bs.As."
    const val WHATSAPP_PHONE = "+5491138405522"
}

enum class OrderStatus(val title: String, val subtitle: String, val stepIndex: Int, val iconEmoji: String) {
    CONFIRMADO("Pedido Confirmado", "Recibido en LitroBar San Miguel", 0, "✅"),
    PREPARANDO_HIELO("En Barra Preparando 1L", "Picando hielo roca, midiendo dosis y decorando", 1, "🧊"),
    EN_CAMINO("En Camino por San Miguel", "El repartidor va en moto térmica con tu vaso de 1L", 2, "🛵"),
    LLEGANDO("¡Llegando a tu Puerta!", "Prepará el vaso o disfrutá directo con el sorbete", 3, "🎉"),
    ENTREGADO("Entregado con Éxito", "¡A disfrutar la noche!", 4, "🍸")
}

data class Order(
    val id: String = "LIT-" + (1000..9999).random(),
    val timestamp: Long = System.currentTimeMillis(),
    val items: List<CartItem>,
    val deliveryMethod: DeliveryMethod,
    val zone: DeliveryZone?,
    val deliveryAddress: String,
    val deliveryNotes: String,
    val customerName: String,
    val customerPhone: String,
    val paymentMethod: PaymentMethod,
    val subtotal: Double,
    val discount: Double,
    val deliveryFee: Double,
    val total: Double,
    val status: OrderStatus = OrderStatus.CONFIRMADO,
    val estimatedArrival: String = "25 - 35 min"
)

data class UserProfile(
    val name: String = "",
    val phone: String = "",
    val address: String = "",
    val selectedZoneId: String = "sm_centro",
    val favoriteDrinkIds: Set<String> = emptySet(),
    val gpsLat: Double? = null,
    val gpsLng: Double? = null
)
