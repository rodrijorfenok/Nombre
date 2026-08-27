package com.example.data.remote

import android.util.Log
import com.example.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class ChatMessage(
    val id: String = java.util.UUID.randomUUID().toString(),
    val sender: MessageSender,
    val text: String,
    val timestamp: Long = System.currentTimeMillis(),
    val suggestedDrinkId: String? = null,
    val suggestedDrinkName: String? = null
)

enum class MessageSender {
    USER,
    BARTENDER_AI
}

class GeminiBartenderService {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val conversationHistory = mutableListOf<JSONObject>()

    private val systemInstruction = """
        Sos "El Barba", el maestro Bartender virtual de LitroBar San Miguel, la mejor app de venta de tragos en vasos de 1 litro de San Miguel, Buenos Aires.
        Tu personalidad es canchera, simpática, conocedora de la noche y de la movida de San Miguel (Plaza San Miguel, Bella Vista, Muñiz, Av. Perón).
        Hablas en español rioplatense (che, previa, trago de 1 litro, hielo roca, romperla).
        
        Tu catálogo de tragos estrella de 1 Litro incluye:
        1. Fernet Branca 1L Clásico SM (con Coca-Cola y hielo roca)
        2. Neon Gin Tonic 1L (Gin premium, tónica, pepino y enebro)
        3. Cyber Mojito XL 1L (Ron Havana Club, menta fresca, lima y soda)
        4. Vodka Energy 1L Power (Vodka + Speed Unlimited)
        5. Campari Orange 1L (Campari + jugo de naranja exprimido)
        6. Caipiroska Frutos Rojos 1L (Vodka + moras, frambuesas y lima)
        7. Aperol Spritz 1L XL (Aperol + espumante + soda)
        8. Jarra Tropical Party 1.5L (Rones, maracuyá y gomitas)
        
        Siempre ayudas al usuario a elegir el trago ideal de 1L según su previa, gusto (dulce, amargo, cítrico, fuerte), cantidad de amigos o presupuesto.
        Si recomiendas un trago específico, menciona su nombre exacto para que puedan pedirlo directamente.
        Mantén respuestas concisas, dinámicas, con emojis y buena onda.
    """.trimIndent()

    suspend fun sendMessage(userText: String): String = withContext(Dispatchers.IO) {
        val apiKey = BuildConfig.GEMINI_API_KEY
        if (apiKey.isBlank() || apiKey == "MY_GEMINI_API_KEY") {
            return@withContext getOfflineFallbackResponse(userText)
        }

        try {
            val userContent = JSONObject().apply {
                put("role", "user")
                put("parts", JSONArray().apply {
                    put(JSONObject().put("text", userText))
                })
            }
            conversationHistory.add(userContent)

            // Keep conversation manageable
            if (conversationHistory.size > 12) {
                conversationHistory.removeAt(0)
                conversationHistory.removeAt(0)
            }

            val contentsArray = JSONArray()
            for (msg in conversationHistory) {
                contentsArray.put(msg)
            }

            val requestBodyJson = JSONObject().apply {
                put("contents", contentsArray)
                put("systemInstruction", JSONObject().apply {
                    put("parts", JSONArray().apply {
                        put(JSONObject().put("text", systemInstruction))
                    })
                })
                put("generationConfig", JSONObject().apply {
                    put("temperature", 0.7)
                    put("topP", 0.95)
                    put("maxOutputTokens", 500)
                })
            }

            val mediaType = "application/json; charset=utf-8".toMediaType()
            val body = requestBodyJson.toString().toRequestBody(mediaType)
            val url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=$apiKey"

            val request = Request.Builder()
                .url(url)
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                Log.e("GeminiService", "Error ${response.code}: $responseBody")
                return@withContext getOfflineFallbackResponse(userText)
            }

            val jsonResponse = JSONObject(responseBody)
            val candidates = jsonResponse.optJSONArray("candidates")
            val firstCandidate = candidates?.optJSONObject(0)
            val content = firstCandidate?.optJSONObject("content")
            val parts = content?.optJSONArray("parts")
            val responseText = parts?.optJSONObject(0)?.optString("text") ?: ""

            if (responseText.isNotBlank()) {
                val modelContent = JSONObject().apply {
                    put("role", "model")
                    put("parts", JSONArray().apply {
                        put(JSONObject().put("text", responseText))
                    })
                }
                conversationHistory.add(modelContent)
                responseText
            } else {
                getOfflineFallbackResponse(userText)
            }
        } catch (e: Exception) {
            Log.e("GeminiService", "Exception in Gemini call", e)
            getOfflineFallbackResponse(userText)
        }
    }

    private fun getOfflineFallbackResponse(input: String): String {
        val lower = input.lowercase()
        return when {
            lower.contains("fernet") || lower.contains("coca") || lower.contains("cordoba") ->
                "¡Qué hacés crack! Para los amantes de lo amargo y clásico, no hay con qué darle al **Fernet Branca 1L Clásico SM**. Con hielo roca de primera y la medida 70/30 que nunca falla. ¿Te lo marcho con vaso descartable o preferís el vaso térmico 1L coleccionable?"
            lower.contains("gin") || lower.contains("tonica") || lower.contains("refrescante") ->
                "¡De una che! El **Neon Gin Tonic 1L** es una bomba de frescura: Gin botánico argentino, tónica helada, rodaja de pepino y bayas de enebro. Entra como agua y en 1 litro te rinde toda la previa."
            lower.contains("dulce") || lower.contains("frut") || lower.contains("rojo") ->
                "Si buscás algo dulce y frutal, te recomiendo con los ojos cerrados la **Caipiroska Frutos Rojos 1L** con pulpa de frambuesas y moras, o el **Cyber Mojito XL 1L** con mucha menta fresca macerada. ¡Son un espectáculo!"
            lower.contains("speed") || lower.contains("vodka") || lower.contains("energia") || lower.contains("fuerte") ->
                "¡Para activar con toda! El **Vodka Energy 1L Power** te viene con Vodka premium y Speed helado. Si querés que pegue más, podés pedir la intensidad 'Power XL' con un shot extra en la personalización."
            lower.contains("amigos") || lower.contains("grupo") || lower.contains("previa") || lower.contains("jarra") ->
                "Para la previa con la banda en San Miguel, lo mejor es la **Jarra Tropical Party 1.5L** con mix de rones, maracuyá y gomitas, o pedirte un par de vasos de 1L variados para compartir. ¡Te llega en 20 minutos con hielo intacto!"
            else ->
                "¡Hola che! Soy El Barba, bartender de LitroBar San Miguel 🍸. Decime qué tenés ganas de tomar (¿algo dulce, amargo, cítrico, o bien fiestero?) y te armo o recomiendo el mejor vaso de 1 Litro para hoy."
        }
    }

    fun resetChat() {
        conversationHistory.clear()
    }
}
