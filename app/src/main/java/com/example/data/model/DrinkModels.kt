package com.example.data.model

import androidx.compose.ui.graphics.Color
import com.example.ui.theme.*

enum class DrinkCategory(val displayName: String, val iconEmoji: String) {
    TODOS("Todos los 1L", "🍸"),
    FERNET("Fernet 1L", "🦅"),
    GIN("Gin Tonic 1L", "🫧"),
    VODKA("Vodka & Speed", "⚡"),
    MOJITO_RON("Mojitos & Ron", "🌿"),
    APERITIVOS("Aperitivos", "🍊"),
    JARRAS_ESPECIALES("Jarras & Especiales", "✨")
}

data class Ingredient(
    val name: String,
    val quantity: String,
    val icon: String
)

data class ExtraAddon(
    val id: String,
    val name: String,
    val price: Double,
    val iconEmoji: String,
    val description: String
)

enum class DrinkSize(
    val id: String,
    val title: String,
    val volumeLabel: String,
    val priceMultiplier: Double,
    val addedPrice: Double,
    val badge: String,
    val description: String
) {
    VASO_1L(
        id = "vaso_1l",
        title = "Vaso 1 Litro Clásico",
        volumeLabel = "1000 ml",
        priceMultiplier = 1.0,
        addedPrice = 0.0,
        badge = "Más Pedido 🔥",
        description = "Vaso gigante descartable reforzado con hielo compacto"
    ),
    VASO_TERMICO_1L(
        id = "termico_1l",
        title = "Vaso Térmico 1L Reutilizable",
        volumeLabel = "1000 ml",
        priceMultiplier = 1.0,
        addedPrice = 1800.0,
        badge = "Mantiene Frío 4hs ❄️",
        description = "Vaso térmico coleccionable LitroBar con tapa y sorbete XL"
    ),
    JARRA_FIESTA_1_5L(
        id = "jarra_1_5l",
        title = "Jarra Party XL 1.5L",
        volumeLabel = "1500 ml",
        priceMultiplier = 1.45,
        addedPrice = 0.0,
        badge = "Para Compartir 👥",
        description = "Jarra gigante de 1.5 litros para la previa con amigos"
    )
}

enum class AlcoholIntensity(
    val label: String,
    val ratioText: String,
    val priceDelta: Double,
    val icon: String,
    val description: String
) {
    SUAVE("Suave", "30% Alcohol / 70% Mixer", 0.0, "🍃", "Tranqui, mucho hielo y sabor refrescante"),
    EQUILIBRADO("Clásico", "70% Mixer / 30% Alcohol", 0.0, "⚖️", "La medida justa y perfecta de la casa"),
    POWER("Power XL", "80% / 20% Extra Alcohol", 900.0, "🔥", "Con un shot extra potente para arrancar la noche"),
    SUPER_STRONG("Demolición", "Doble Shot + Alcohol Premium", 1500.0, "💣", "Carga máxima recomendada para compartir")
}

data class Drink(
    val id: String,
    val name: String,
    val subtitle: String,
    val description: String,
    val basePrice: Double,
    val category: DrinkCategory,
    val alcoholPercentage: String,
    val liquidPrimaryColor: Color,
    val liquidSecondaryColor: Color,
    val garnishEmoji: String,
    val garnishName: String,
    val ingredients: List<Ingredient>,
    val tags: List<String>,
    val defaultIceLevel: String = "Abundante en roca",
    val preparationTimeMinutes: Int = 5,
    val popularityScore: Float = 4.9f,
    val isSignature1L: Boolean = true
)
