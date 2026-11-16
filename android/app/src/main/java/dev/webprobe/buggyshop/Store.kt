package dev.webprobe.buggyshop

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.setValue

data class Review(val author: String, val rating: Int, val text: String)

data class Product(
    val id: String,
    val name: String,
    val price: Int,
    val description: String,
    val reviews: List<Review>,
)

val products = listOf(
    Product(
        "mug", "Ceramic Mug", 14, "A 350 ml stoneware mug. Dishwasher safe.",
        listOf(Review("Lin", 5, "Keeps coffee warm for ages."), Review("Sam", 4, "Nice glaze, a bit heavy.")),
    ),
    Product(
        "notebook", "Dot Grid Notebook", 9, "A5, 160 pages, lay-flat binding.",
        listOf(Review("Ana", 5, "Fountain pen friendly.")),
    ),
    Product("lamp", "Desk Lamp", 39, "Dimmable LED desk lamp with USB-C power.", emptyList()),
)

// qty is what the total uses, shownQty what the screen shows. They differ only with cart-zero-qty on.
data class CartLine(val product: Product, val qty: Int, val shownQty: Int)

const val SHIPPING_FEE = 5
const val FREE_SHIPPING_OVER = 50
val coupons = mapOf("SAVE10" to 10, "WELCOME20" to 20)

class Store {
    val lines = mutableStateListOf<CartLine>()
    var discount by mutableIntStateOf(0)
    private var lastOrder = 1000

    val count get() = lines.sumOf { it.shownQty }
    val subtotal get() = lines.sumOf { it.product.price * it.qty }

    val shipping: Int
        get() {
            // BUG checkout-free-shipping: compares the number of items, not their price.
            val over = if (Bugs.on(Bug.CheckoutFreeShipping)) count > FREE_SHIPPING_OVER else subtotal > FREE_SHIPPING_OVER
            return if (over) 0 else SHIPPING_FEE
        }

    fun add(product: Product) {
        val i = lines.indexOfFirst { it.product.id == product.id }
        if (i >= 0) {
            val q = lines[i].qty + 1
            lines[i] = lines[i].copy(qty = q, shownQty = q)
        } else {
            lines.add(CartLine(product, 1, 1))
        }
    }

    fun setQuantity(id: String, qty: Int) {
        val i = lines.indexOfFirst { it.product.id == id }
        if (i < 0) return
        if (qty <= 0) {
            // BUG cart-zero-qty: the screen shows 0 but the item stays and keeps its old quantity
            // in the total. Correct: remove the line.
            if (Bugs.on(Bug.CartZeroQty)) lines[i] = lines[i].copy(shownQty = 0) else lines.removeAt(i)
            return
        }
        lines[i] = lines[i].copy(qty = qty, shownQty = qty)
    }

    fun placeOrder(): Int {
        lastOrder += 1
        lines.clear()
        discount = 0
        return lastOrder
    }
}
