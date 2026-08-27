package com.example.ui.screens.cart

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
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
import com.example.data.model.*
import com.example.ui.theme.*
import java.net.URLEncoder

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CartScreen(
    cartItems: List<CartItem>,
    selectedDeliveryMethod: DeliveryMethod,
    selectedZone: DeliveryZone,
    userProfile: UserProfile,
    onDeliveryMethodChange: (DeliveryMethod) -> Unit,
    onZoneClick: () -> Unit,
    onUpdateQuantity: (String, Int) -> Unit,
    onRemoveItem: (String) -> Unit,
    onClearCart: () -> Unit,
    onPlaceOrder: (Order) -> Unit,
    onExploreCatalog: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current

    var customerName by remember(userProfile.name) { mutableStateOf(userProfile.name) }
    var customerPhone by remember(userProfile.phone) { mutableStateOf(userProfile.phone) }
    var customerAddress by remember(userProfile.address) { mutableStateOf(userProfile.address) }
    var deliveryNotes by remember { mutableStateOf("") }
    var selectedPayment by remember { mutableStateOf(PaymentMethod.EFECTIVO) }

    val subtotal = remember(cartItems) {
        cartItems.sumOf { it.totalPrice }
    }

    val discount = remember(selectedDeliveryMethod, subtotal) {
        if (selectedDeliveryMethod == DeliveryMethod.TAKE_AWAY) subtotal * 0.10 else 0.0
    }

    val deliveryFee = remember(selectedDeliveryMethod, selectedZone, subtotal) {
        if (selectedDeliveryMethod == DeliveryMethod.TAKE_AWAY) {
            0.0
        } else if (subtotal >= selectedZone.minOrderForFreeDelivery) {
            0.0
        } else {
            selectedZone.deliveryFee
        }
    }

    val total = (subtotal - discount + deliveryFee).coerceAtLeast(0.0)

    fun sendOrderViaWhatsApp() {
        if (cartItems.isEmpty()) return
        if (customerName.isBlank() || customerPhone.isBlank()) {
            Toast.makeText(context, "Por favor completá tu nombre y teléfono", Toast.LENGTH_SHORT).show()
            return
        }
        if (selectedDeliveryMethod == DeliveryMethod.DELIVERY && customerAddress.isBlank()) {
            Toast.makeText(context, "Por favor indicá tu dirección en San Miguel", Toast.LENGTH_SHORT).show()
            return
        }

        val order = Order(
            items = cartItems,
            deliveryMethod = selectedDeliveryMethod,
            zone = if (selectedDeliveryMethod == DeliveryMethod.DELIVERY) selectedZone else null,
            deliveryAddress = if (selectedDeliveryMethod == DeliveryMethod.DELIVERY) customerAddress else SanMiguelZones.STORE_ADDRESS,
            deliveryNotes = deliveryNotes,
            customerName = customerName,
            customerPhone = customerPhone,
            paymentMethod = selectedPayment,
            subtotal = subtotal,
            discount = discount,
            deliveryFee = deliveryFee,
            total = total
        )

        val messageBuilder = StringBuilder()
        messageBuilder.append("🍹 *NUEVO PEDIDO LITROBAR SAN MIGUEL* 🍹\n\n")
        messageBuilder.append("👤 *Cliente:* $customerName\n")
        messageBuilder.append("📞 *Tel:* $customerPhone\n")
        messageBuilder.append("🛵 *Modo:* ${selectedDeliveryMethod.title}\n")
        if (selectedDeliveryMethod == DeliveryMethod.DELIVERY) {
            messageBuilder.append("📍 *Zona:* ${selectedZone.name}\n")
            messageBuilder.append("🏠 *Dirección:* $customerAddress\n")
            if (deliveryNotes.isNotBlank()) messageBuilder.append("📝 *Notas:* $deliveryNotes\n")
        } else {
            messageBuilder.append("🏪 *Retiro en:* ${SanMiguelZones.STORE_ADDRESS} (10% OFF)\n")
        }
        messageBuilder.append("💳 *Pago:* ${selectedPayment.title}\n\n")
        messageBuilder.append("🍸 *DETALLE DEL PEDIDO (VASOS 1L):*\n")

        cartItems.forEachIndexed { index, item ->
            messageBuilder.append("${index + 1}. *${item.quantity}x ${item.drink.name}* (${item.size.title})\n")
            messageBuilder.append("   • Intensidad: ${item.intensity.label}\n")
            if (item.selectedExtras.isNotEmpty()) {
                messageBuilder.append("   • Extras: ${item.selectedExtras.joinToString { it.name }}\n")
            }
            if (item.specialNotes.isNotBlank()) {
                messageBuilder.append("   • Nota: ${item.specialNotes}\n")
            }
            messageBuilder.append("   • Subtotal: $${item.totalPrice.toInt()}\n\n")
        }

        messageBuilder.append("────────────────────\n")
        messageBuilder.append("Subtotal: $${subtotal.toInt()}\n")
        if (discount > 0) messageBuilder.append("Descuento Take Away (10%): -$${discount.toInt()}\n")
        messageBuilder.append("Envío: ${if (deliveryFee == 0.0) "GRATIS" else "$${deliveryFee.toInt()}"}\n")
        messageBuilder.append("*TOTAL A PAGAR: $${total.toInt()}*\n")

        onPlaceOrder(order)

        try {
            val encodedMessage = URLEncoder.encode(messageBuilder.toString(), "UTF-8")
            val url = "https://wa.me/${SanMiguelZones.WHATSAPP_PHONE}?text=$encodedMessage"
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            context.startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(context, "Pedido generado con éxito en el sistema", Toast.LENGTH_LONG).show()
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBg)
    ) {
        // Top Header
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
                    imageVector = Icons.Default.ShoppingCart,
                    contentDescription = null,
                    tint = NeonLime,
                    modifier = Modifier.size(24.dp)
                )
                Text(
                    text = "Tu Pedido de 1L",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Black,
                    color = TextPrimary
                )
            }

            if (cartItems.isNotEmpty()) {
                TextButton(
                    onClick = onClearCart,
                    colors = ButtonDefaults.textButtonColors(contentColor = NeonPink)
                ) {
                    Text(text = "Vaciar", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        HorizontalDivider(color = DarkBorder)

        if (cartItems.isEmpty()) {
            // Empty Cart State
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text(text = "🧊", fontSize = 64.sp)
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Tu carrito de 1L está vacío",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )
                Text(
                    text = "Elegí tus tragos favoritos o armá tu propio vaso de 1 litro personalizado para la previa.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = onExploreCatalog,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = NeonLime,
                        contentColor = Color(0xFF0C0D12)
                    ),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.height(48.dp)
                ) {
                    Text(text = "Ver Catálogo de 1 Litro 🍸", fontWeight = FontWeight.Bold)
                }
            }
        } else {
            // Cart with items
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Cart Items List
                Text(
                    text = "TRAGOS EN TU PEDIDO (${cartItems.sumOf { it.quantity }})",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextMuted,
                    letterSpacing = 1.sp
                )

                cartItems.forEach { item ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .border(1.dp, DarkBorder, RoundedCornerShape(16.dp)),
                        colors = CardDefaults.cardColors(containerColor = DarkSurface)
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.Top
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Surface(
                                        color = DarkSurfaceVariant,
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.size(42.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Text(text = item.drink.garnishEmoji, fontSize = 20.sp)
                                        }
                                    }
                                    Column {
                                        Text(
                                            text = item.drink.name,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 14.sp,
                                            color = TextPrimary
                                        )
                                        Text(
                                            text = "${item.size.title} • ${item.intensity.label}",
                                            fontSize = 11.sp,
                                            color = TextSecondary
                                        )
                                    }
                                }

                                IconButton(
                                    onClick = { onRemoveItem(item.id) },
                                    modifier = Modifier.size(28.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.DeleteOutline,
                                        contentDescription = "Eliminar",
                                        tint = TextMuted,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }

                            if (item.selectedExtras.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "Extras: " + item.selectedExtras.joinToString { it.name },
                                    fontSize = 11.sp,
                                    color = NeonLimeLight
                                )
                            }

                            Spacer(modifier = Modifier.height(10.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "$${item.totalPrice.toInt()}",
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Black,
                                    color = NeonLime
                                )

                                Row(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(DarkSurfaceVariant)
                                        .padding(horizontal = 4.dp, vertical = 2.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    IconButton(
                                        onClick = {
                                            if (item.quantity > 1) {
                                                onUpdateQuantity(item.id, item.quantity - 1)
                                            } else {
                                                onRemoveItem(item.id)
                                            }
                                        },
                                        modifier = Modifier.size(28.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.Remove,
                                            contentDescription = "Restar",
                                            tint = TextPrimary,
                                            modifier = Modifier.size(14.dp)
                                        )
                                    }

                                    Text(
                                        text = "${item.quantity}",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 13.sp,
                                        color = TextPrimary,
                                        modifier = Modifier.padding(horizontal = 6.dp)
                                    )

                                    IconButton(
                                        onClick = { onUpdateQuantity(item.id, item.quantity + 1) },
                                        modifier = Modifier.size(28.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.Add,
                                            contentDescription = "Sumar",
                                            tint = NeonLime,
                                            modifier = Modifier.size(14.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                // Delivery Method Switcher
                Text(
                    text = "MÉTODO DE ENTREGA",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextMuted,
                    letterSpacing = 1.sp
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    DeliveryMethod.values().forEach { method ->
                        val isSelected = selectedDeliveryMethod == method
                        Card(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(14.dp))
                                .border(
                                    BorderStroke(
                                        width = if (isSelected) 1.5.dp else 1.dp,
                                        color = if (isSelected) NeonLime else DarkBorder
                                    ),
                                    RoundedCornerShape(14.dp)
                                )
                                .clickable { onDeliveryMethodChange(method) },
                            colors = CardDefaults.cardColors(
                                containerColor = if (isSelected) NeonLime.copy(alpha = 0.1f) else DarkSurface
                            )
                        ) {
                            Column(
                                modifier = Modifier.padding(12.dp),
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                Text(text = method.iconEmoji, fontSize = 24.sp)
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = method.title,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isSelected) NeonLime else TextPrimary,
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                                )
                            }
                        }
                    }
                }

                // Zone Selector (if Delivery)
                if (selectedDeliveryMethod == DeliveryMethod.DELIVERY) {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .border(1.dp, DarkBorder, RoundedCornerShape(14.dp))
                            .clickable(onClick = onZoneClick),
                        colors = CardDefaults.cardColors(containerColor = DarkSurface)
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
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.LocationOn,
                                    contentDescription = null,
                                    tint = NeonLime
                                )
                                Column {
                                    Text(
                                        text = "Zona: ${selectedZone.name}",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 13.sp,
                                        color = TextPrimary
                                    )
                                    Text(
                                        text = "Tiempo est. ${selectedZone.estimatedMinutes} • Envío $${selectedZone.deliveryFee.toInt()}",
                                        fontSize = 11.sp,
                                        color = TextSecondary
                                    )
                                }
                            }
                            Text(
                                text = "Cambiar",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = NeonLime
                            )
                        }
                    }

                    // Address input
                    OutlinedTextField(
                        value = customerAddress,
                        onValueChange = { customerAddress = it },
                        label = { Text("Calle, Altura y Esquina (San Miguel)") },
                        placeholder = { Text("Ej. Av. Balbín 1234 e/ Mitre y Belgrano") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("address_input"),
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = NeonLime,
                            unfocusedBorderColor = DarkBorder,
                            focusedContainerColor = DarkSurface,
                            unfocusedContainerColor = DarkSurface
                        )
                    )
                }

                // Customer Data
                Text(
                    text = "DATOS DE CONTACTO",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextMuted,
                    letterSpacing = 1.sp
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedTextField(
                        value = customerName,
                        onValueChange = { customerName = it },
                        label = { Text("Tu Nombre") },
                        modifier = Modifier
                            .weight(1f)
                            .testTag("customer_name_input"),
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = NeonLime,
                            unfocusedBorderColor = DarkBorder,
                            focusedContainerColor = DarkSurface,
                            unfocusedContainerColor = DarkSurface
                        ),
                        singleLine = true
                    )

                    OutlinedTextField(
                        value = customerPhone,
                        onValueChange = { customerPhone = it },
                        label = { Text("WhatsApp") },
                        modifier = Modifier
                            .weight(1f)
                            .testTag("customer_phone_input"),
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = NeonLime,
                            unfocusedBorderColor = DarkBorder,
                            focusedContainerColor = DarkSurface,
                            unfocusedContainerColor = DarkSurface
                        ),
                        singleLine = true
                    )
                }

                // Payment Method
                Text(
                    text = "FORMA DE PAGO",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextMuted,
                    letterSpacing = 1.sp
                )

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PaymentMethod.values().forEach { payment ->
                        val isSelected = selectedPayment == payment
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .border(
                                    BorderStroke(
                                        width = if (isSelected) 1.5.dp else 1.dp,
                                        color = if (isSelected) NeonLime else DarkBorder
                                    ),
                                    RoundedCornerShape(12.dp)
                                )
                                .clickable { selectedPayment = payment },
                            colors = CardDefaults.cardColors(
                                containerColor = if (isSelected) NeonLime.copy(alpha = 0.08f) else DarkSurface
                            )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Text(text = payment.iconEmoji, fontSize = 20.sp)
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = payment.title,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 13.sp,
                                        color = if (isSelected) NeonLime else TextPrimary
                                    )
                                    Text(
                                        text = payment.detail,
                                        fontSize = 11.sp,
                                        color = TextSecondary
                                    )
                                }
                                RadioButton(
                                    selected = isSelected,
                                    onClick = { selectedPayment = payment },
                                    colors = RadioButtonDefaults.colors(
                                        selectedColor = NeonLime
                                    )
                                )
                            }
                        }
                    }
                }

                // Summary Calculation Card
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .border(1.dp, DarkBorder, RoundedCornerShape(16.dp)),
                    colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = "RESUMEN FINAL",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextMuted
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(text = "Subtotal Tragos 1L", color = TextSecondary, fontSize = 13.sp)
                            Text(text = "$${subtotal.toInt()}", color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }

                        if (discount > 0) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(text = "Descuento Retiro en Barra (10%)", color = NeonPink, fontSize = 13.sp)
                                Text(text = "-$${discount.toInt()}", color = NeonPink, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = if (selectedDeliveryMethod == DeliveryMethod.DELIVERY) "Envío (${selectedZone.name})" else "Retiro en Local",
                                color = TextSecondary,
                                fontSize = 13.sp
                            )
                            Text(
                                text = if (deliveryFee == 0.0) "GRATIS" else "$${deliveryFee.toInt()}",
                                color = if (deliveryFee == 0.0) NeonLime else TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }

                        HorizontalDivider(color = DarkBorder, modifier = Modifier.padding(vertical = 4.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "TOTAL A PAGAR",
                                fontWeight = FontWeight.Black,
                                fontSize = 15.sp,
                                color = TextPrimary
                            )
                            Text(
                                text = "$${total.toInt()}",
                                fontWeight = FontWeight.Black,
                                fontSize = 22.sp,
                                color = NeonLime
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))
            }

            // Bottom Floating Actions
            HorizontalDivider(color = DarkBorder)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DarkSurface)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Primary WhatsApp CTA
                Button(
                    onClick = { sendOrderViaWhatsApp() },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp)
                        .testTag("whatsapp_checkout_button"),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = WhatsAppColor,
                        contentColor = Color.White
                    )
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(text = "📲", fontSize = 18.sp)
                        Text(
                            text = "Pedir por WhatsApp ($${total.toInt()})",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Black
                        )
                    }
                }
            }
        }
    }
}
