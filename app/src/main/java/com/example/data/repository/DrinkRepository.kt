package com.example.data.repository

import androidx.compose.ui.graphics.Color
import com.example.data.model.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class DrinkRepository {

    private val _drinks = MutableStateFlow<List<Drink>>(sampleDrinks)
    val drinks: StateFlow<List<Drink>> = _drinks.asStateFlow()

    private val _extraAddons = MutableStateFlow<List<ExtraAddon>>(availableAddons)
    val extraAddons: StateFlow<List<ExtraAddon>> = _extraAddons.asStateFlow()

    fun getDrinkById(id: String): Drink? {
        return _drinks.value.find { it.id == id }
    }

    companion object {
        val availableAddons = listOf(
            ExtraAddon(
                id = "led_cup",
                name = "Vaso Neón con Luz LED",
                price = 950.0,
                iconEmoji = "💡",
                description = "Vaso 1L luminoso con 3 modos de luces para la fiesta"
            ),
            ExtraAddon(
                id = "hielo_roca",
                name = "Hielo Roca XL Extra",
                price = 350.0,
                iconEmoji = "🧊",
                description = "Hielo macizo cristalino que no se derrite rápido"
            ),
            ExtraAddon(
                id = "gomitas_acidas",
                name = "Brocheta de Gomitas Ácidas",
                price = 450.0,
                iconEmoji = "🍬",
                description = "Gomitas frutales marinadas para comer con el trago"
            ),
            ExtraAddon(
                id = "sorbete_gigante",
                name = "Sorbete Gigante 1L",
                price = 200.0,
                iconEmoji = "🥤",
                description = "Sorbete grueso de 30cm biodegradable"
            ),
            ExtraAddon(
                id = "shot_extra",
                name = "Shot Extra de Licor/Destilado",
                price = 1200.0,
                iconEmoji = "🥃",
                description = "Tubo de ensayo con dosis extra para sumar a tu 1L"
            )
        )

        val sampleDrinks = listOf(
            Drink(
                id = "fernet_1l_sanmiguel",
                name = "Fernet Branca 1L Clásico SM",
                subtitle = "El infaltable cordobés estilo San Miguel",
                description = "Vaso de 1 Litro con Fernet Branca original, Coca-Cola bien helada con gas a pleno, hielo roca macizo y corona espumosa perfecta.",
                basePrice = 5200.0,
                category = DrinkCategory.FERNET,
                alcoholPercentage = "39% Vol (Base)",
                liquidPrimaryColor = Color(0xFF1E110A),
                liquidSecondaryColor = Color(0xFF3E1F12),
                garnishEmoji = "🦅",
                garnishName = "Espuma & Hielo Roca",
                ingredients = listOf(
                    Ingredient("Fernet Branca Original", "300 ml", "🥃"),
                    Ingredient("Coca-Cola Helada", "700 ml", "🫧"),
                    Ingredient("Hielo Roca Cristal", "Abundante", "🧊")
                ),
                tags = listOf("Top 1 Más Pedido", "El Rey del Litro", "Previa"),
                popularityScore = 5.0f,
                isSignature1L = true
            ),
            Drink(
                id = "neon_gin_tonic_1l",
                name = "Neon Gin Tonic 1L",
                subtitle = "Gin botánico, tónica y frutos seleccionados",
                description = "1 Litro de Gin infusionado artesanal, Agua Tónica premium Schweppes, rodajas finas de pepino, bayas de enebro y toque cítrico de pomelo rosado.",
                basePrice = 4900.0,
                category = DrinkCategory.GIN,
                alcoholPercentage = "38% Vol (Base)",
                liquidPrimaryColor = Color(0xFFB8E63C),
                liquidSecondaryColor = Color(0xFF86D62E),
                garnishEmoji = "🥒",
                garnishName = "Pepino & Bayas de Enebro",
                ingredients = listOf(
                    Ingredient("Gin Príncipe de los Apóstoles / London Dry", "250 ml", "🍸"),
                    Ingredient("Agua Tónica Premium", "750 ml", "🫧"),
                    Ingredient("Rodajas de Pepino y Pomelo", "2 unidades", "🥒"),
                    Ingredient("Bayas de Enebro", "4 bayas", "🌿")
                ),
                tags = listOf("Súper Refrescante", "Cítrico & Herbal", "Recomendado"),
                popularityScore = 4.9f,
                isSignature1L = true
            ),
            Drink(
                id = "cyber_mojito_1l",
                name = "Cyber Mojito XL 1L",
                subtitle = "Ron dorado, menta de huerta y lima macerada",
                description = "1 Litro de pura frescura caribeña: Ron Havana Club, abundante menta fresca machacada, limas jugosas de San Miguel, almíbar casero y soda bien gasificada.",
                basePrice = 4800.0,
                category = DrinkCategory.MOJITO_RON,
                alcoholPercentage = "37.5% Vol (Base)",
                liquidPrimaryColor = Color(0xFF00E676),
                liquidSecondaryColor = Color(0xFF1DE9B6),
                garnishEmoji = "🌿",
                garnishName = "Penacho de Menta & Lima",
                ingredients = listOf(
                    Ingredient("Ron Havana Club Especial", "250 ml", "🥃"),
                    Ingredient("Hojas de Menta Fresca", "12 hojas", "🌿"),
                    Ingredient("Jugo de Lima Macerada", "60 ml", "🍋"),
                    Ingredient("Soda Helada & Almíbar", "690 ml", "🫧")
                ),
                tags = listOf("Frescura Total", "Dulce Equilibrado"),
                popularityScore = 4.8f,
                isSignature1L = true
            ),
            Drink(
                id = "vodka_energy_1l",
                name = "Vodka Energy 1L Power",
                subtitle = "Vodka Smirnoff / Skyy + Speed Unlimited",
                description = "El clásico de la noche bonaerense: 1 Litro con Vodka premium a elección, energizante Speed Unlimited helado, toque de jugo de naranja o frutos del bosque.",
                basePrice = 4700.0,
                category = DrinkCategory.VODKA,
                alcoholPercentage = "37.5% Vol (Base)",
                liquidPrimaryColor = Color(0xFFFF9F1C),
                liquidSecondaryColor = Color(0xFFFF5C7A),
                garnishEmoji = "⚡",
                garnishName = "Rodaja de Naranja & Speed",
                ingredients = listOf(
                    Ingredient("Vodka Destilado Premium", "250 ml", "🍸"),
                    Ingredient("Speed Unlimited Energy", "750 ml", "⚡"),
                    Ingredient("Hielo Picado Compacto", "Abundante", "🧊")
                ),
                tags = listOf("Explosión de Energía", "Ideal Fiesta"),
                popularityScore = 4.9f,
                isSignature1L = true
            ),
            Drink(
                id = "campari_orange_1l",
                name = "Campari Orange & Tonic 1L",
                subtitle = "Campari italiano amargo y cítrico jugoso",
                description = "1 Litro de Campari Bitter Milano mezclado con jugo natural de naranja recién exprimido y golpe de tónica gasificada, decorado con medias lunas de naranja.",
                basePrice = 4600.0,
                category = DrinkCategory.APERITIVOS,
                alcoholPercentage = "25% Vol (Base)",
                liquidPrimaryColor = Color(0xFFFF2A6D),
                liquidSecondaryColor = Color(0xFFFF6F00),
                garnishEmoji = "🍊",
                garnishName = "Medias Lunas de Naranja",
                ingredients = listOf(
                    Ingredient("Campari Bitter Milano", "300 ml", "🥃"),
                    Ingredient("Jugo de Naranja Natural", "500 ml", "🍊"),
                    Ingredient("Agua Tónica & Hielo", "200 ml", "🫧")
                ),
                tags = listOf("Amargo Clásico", "Aperitivo"),
                popularityScore = 4.7f,
                isSignature1L = true
            ),
            Drink(
                id = "caipiroska_frutos_rojos_1l",
                name = "Caipiroska Frutos Rojos 1L",
                subtitle = "Vodka con pulpa de frambuesas, moras y lima",
                description = "Vaso de 1 Litro lleno de color: Vodka Smirnoff macerado con frambuesas, arándanos y moras de la Patagonia, limas machacadas y azúcar orgánica.",
                basePrice = 5100.0,
                category = DrinkCategory.VODKA,
                alcoholPercentage = "35% Vol",
                liquidPrimaryColor = Color(0xFFD81B60),
                liquidSecondaryColor = Color(0xFF880E4F),
                garnishEmoji = "🍓",
                garnishName = "Frutos del Bosque Enteros",
                ingredients = listOf(
                    Ingredient("Vodka Premium", "250 ml", "🍸"),
                    Ingredient("Pulpa Frutos Rojos Casera", "150 ml", "🍓"),
                    Ingredient("Lima Macerada y Azúcar", "50 ml", "🍋"),
                    Ingredient("Hielo Triturado Frappé", "550 ml", "🧊")
                ),
                tags = listOf("Frutal Intenso", "Dulce & Ácido"),
                popularityScore = 4.9f,
                isSignature1L = true
            ),
            Drink(
                id = "aperol_spritz_1l",
                name = "Aperol Spritz 1L XL",
                subtitle = "Aperol, Espumante Extra Brut y soda",
                description = "La versión gigante del trago de moda en Europa y San Miguel: Aperol, vino espumante Extra Brut bien frío, toque de soda y rodajas gigantes de naranja.",
                basePrice = 5400.0,
                category = DrinkCategory.APERITIVOS,
                alcoholPercentage = "15% Vol",
                liquidPrimaryColor = Color(0xFFFF5722),
                liquidSecondaryColor = Color(0xFFFF9800),
                garnishEmoji = "🍊",
                garnishName = "Naranja & Aceituna Opcional",
                ingredients = listOf(
                    Ingredient("Aperol Italiano", "350 ml", "🥃"),
                    Ingredient("Espumante Extra Brut", "500 ml", "🍾"),
                    Ingredient("Soda Helada", "150 ml", "🫧")
                ),
                tags = listOf("Elegante", "Burbujeante", "Tarde/Noche"),
                popularityScore = 4.8f,
                isSignature1L = true
            ),
            Drink(
                id = "jarra_tropical_party_1_5l",
                name = "Jarra Tropical Party 1.5L Especial",
                subtitle = "Mix de Rones, Maracuyá, Naranja y Granadina",
                description = "La joya de LitroBar para grupos: Jarra gigante de 1.5 Litros con blend de Ron blanco y dorado, maracuyá natural, jugo de naranja, granadina y lluvia de gomitas.",
                basePrice = 7200.0,
                category = DrinkCategory.JARRAS_ESPECIALES,
                alcoholPercentage = "28% Vol",
                liquidPrimaryColor = Color(0xFFFF0055),
                liquidSecondaryColor = Color(0xFFFFCC00),
                garnishEmoji = "🍍",
                garnishName = "Rodaja de Ananá, Maracuyá & Gomitas",
                ingredients = listOf(
                    Ingredient("Blend Rones Caribeños", "400 ml", "🥃"),
                    Ingredient("Pulpa de Maracuyá Natural", "200 ml", "🍍"),
                    Ingredient("Jugo de Naranja & Sprite", "850 ml", "🍊"),
                    Ingredient("Garnish Gomitas & Hielo", "50 g", "🍬")
                ),
                tags = listOf("Jarra 1.5 Litros", "Súper Rendidor", "Fiesta"),
                popularityScore = 5.0f,
                isSignature1L = true
            )
        )
    }
}
