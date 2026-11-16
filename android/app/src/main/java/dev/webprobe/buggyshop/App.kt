package dev.webprobe.buggyshop

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import java.util.Locale

enum class Section { Products, Cart, Signup }

enum class SortOrder(val label: String) {
    Featured("Featured"),
    LowToHigh("Price: low to high"),
    HighToLow("Price: high to low"),
}

private fun money(x: Double) = "$" + String.format(Locale.US, "%.2f", x)

// Three tabs, like the iOS app. Each tab has at most one screen pushed on top of it (a product,
// checkout), and the system back button pops it.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App() {
    val store = remember { Store() }
    var tab by remember { mutableStateOf(Section.Products) }
    var product by remember { mutableStateOf<Product?>(null) }
    var checkout by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf(SortOrder.Featured) }

    val pushed = (tab == Section.Products && product != null) || (tab == Section.Cart && checkout)
    val back: () -> Unit = {
        if (tab == Section.Products) {
            product = null
        } else {
            checkout = false
        }
    }
    BackHandler(enabled = pushed) { back() }

    val title = when (tab) {
        Section.Products -> product?.name ?: "Products"
        Section.Cart -> if (checkout) "Checkout" else "Cart"
        Section.Signup -> "Sign up"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    if (pushed) {
                        IconButton(onClick = back) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == Section.Products, onClick = { tab = Section.Products },
                    icon = { Icon(Icons.Filled.Home, contentDescription = null) }, label = { Text("Products") },
                )
                NavigationBarItem(
                    selected = tab == Section.Cart, onClick = { tab = Section.Cart },
                    icon = {
                        BadgedBox(badge = { if (store.count > 0) Badge { Text("${store.count}") } }) {
                            Icon(Icons.Filled.ShoppingCart, contentDescription = null)
                        }
                    },
                    label = { Text("Cart") },
                )
                NavigationBarItem(
                    selected = tab == Section.Signup, onClick = { tab = Section.Signup },
                    icon = { Icon(Icons.Filled.Person, contentDescription = null) }, label = { Text("Sign up") },
                )
            }
        },
    ) { inner ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(inner)
                .consumeWindowInsets(inner)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (tab) {
                Section.Products -> {
                    val p = product
                    if (p == null) {
                        ProductList(store, query, { query = it }, sort, { sort = it }) { product = it }
                    } else {
                        ProductDetail(store, p)
                    }
                }
                Section.Cart -> if (checkout) Checkout(store) else Cart(store) { checkout = true }
                Section.Signup -> Signup()
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProductList(
    store: Store,
    query: String,
    onQuery: (String) -> Unit,
    sort: SortOrder,
    onSort: (SortOrder) -> Unit,
    open: (Product) -> Unit,
) {
    val q = query.trim()
    // BUG search-case-sensitive: "mug" finds nothing, "Mug" finds the Ceramic Mug.
    val matching = products.filter {
        q.isEmpty() || if (Bugs.on(Bug.SearchCaseSensitive)) it.name.contains(q) else it.name.contains(q, ignoreCase = true)
    }
    // BUG sort-price-string: compares prices as text, so $9 sorts after $39.
    val asc = matching.sortedWith { a, b ->
        if (Bugs.on(Bug.SortPriceString)) a.price.toString().compareTo(b.price.toString()) else a.price.compareTo(b.price)
    }
    val shown = when (sort) {
        SortOrder.Featured -> matching
        SortOrder.LowToHigh -> asc
        SortOrder.HighToLow -> asc.reversed()
    }

    OutlinedTextField(
        value = query, onValueChange = onQuery, label = { Text("Search products") },
        singleLine = true, modifier = Modifier.fillMaxWidth(),
    )
    Text("Sort by", style = MaterialTheme.typography.titleSmall)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SortOrder.entries.forEach {
            FilterChip(selected = sort == it, onClick = { onSort(it) }, label = { Text(it.label) })
        }
    }
    HorizontalDivider()
    if (shown.isEmpty()) Text("No products match “$query”.")
    shown.forEach { p ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(
                Modifier
                    .weight(1f)
                    .clickable(role = Role.Button) { open(p) }
                    .padding(vertical = 8.dp),
            ) {
                Text(p.name, style = MaterialTheme.typography.titleMedium)
                Text("$${p.price}")
            }
            IconButton(onClick = { store.add(p) }) {
                // BUG add-button-unlabeled: an icon-only button with no content description, so
                // TalkBack (and the accessibility tree) has nothing to call it.
                Icon(
                    Icons.Filled.AddCircle,
                    contentDescription = if (Bugs.on(Bug.AddButtonUnlabeled)) null else "Add ${p.name} to cart",
                )
            }
        }
    }
}

@Composable
fun ProductDetail(store: Store, product: Product) {
    var added by remember(product.id) { mutableStateOf(false) }
    var tab by remember(product.id) { mutableIntStateOf(0) }

    Text("$${product.price}", style = MaterialTheme.typography.headlineSmall)
    Button(onClick = { store.add(product); added = true }) { Text(if (added) "Added" else "Add to cart") }
    TabRow(selectedTabIndex = tab) {
        Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Description") })
        Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Reviews (${product.reviews.size})") })
    }
    if (tab == 0) Text(product.description) else Reviews(product.reviews)
}

@Composable
fun Reviews(reviews: List<Review>) {
    // BUG reviews-crash: reads the first review before checking there is one, so a product with
    // no reviews crashes the app (index out of bounds).
    if (Bugs.on(Bug.ReviewsCrash)) {
        val first = reviews[0]
        Text("Top review by ${first.author}")
    } else if (reviews.isEmpty()) {
        Text("No reviews yet.")
    }
    reviews.forEach {
        Column {
            Text("${it.author} – ${"★".repeat(it.rating)}")
            Text(it.text, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun Cart(store: Store, checkout: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }

    if (store.lines.isEmpty()) {
        Text("Your cart is empty.")
        return
    }
    Text("Items", style = MaterialTheme.typography.titleSmall)
    store.lines.forEach { line ->
        val name = line.product.name
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("$name, $${line.product.price}, quantity ${line.shownQty}", Modifier.weight(1f))
            IconButton(
                onClick = { store.setQuantity(line.product.id, line.shownQty - 1) },
                enabled = line.shownQty > 0,
                modifier = Modifier.semantics { contentDescription = "Decrease quantity of $name" },
            ) { Text("−", style = MaterialTheme.typography.titleLarge) }
            IconButton(onClick = { store.setQuantity(line.product.id, line.shownQty + 1) }) {
                Icon(Icons.Filled.Add, contentDescription = "Increase quantity of $name")
            }
        }
    }
    HorizontalDivider()
    Text("Coupon", style = MaterialTheme.typography.titleSmall)
    OutlinedTextField(
        value = code, onValueChange = { code = it }, label = { Text("Coupon code") }, singleLine = true,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
        modifier = Modifier.fillMaxWidth(),
    )
    Button(onClick = {
        message = null
        // BUG coupon-silent: the coupon service is "down" and the failure is swallowed: no
        // discount and no message. Correct: valid codes apply, anything else shows an error.
        if (!Bugs.on(Bug.CouponSilent)) {
            val off = coupons[code.trim().uppercase()]
            if (off != null) {
                store.discount = off
                message = "Coupon applied: $off% off"
            } else {
                message = "This coupon code is not valid."
            }
        }
    }) { Text("Apply") }
    message?.let { Text(it) }
    HorizontalDivider()
    Text("Total: " + money(store.subtotal * (1 - store.discount / 100.0)), style = MaterialTheme.typography.titleMedium)
    Text("Free shipping when your items come to more than $$FREE_SHIPPING_OVER.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    Button(onClick = checkout) { Text("Checkout") }
}

@Composable
fun Checkout(store: Store) {
    var name by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var zip by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var placed by remember { mutableStateOf<Int?>(null) }

    placed?.let {
        Text("Thank you! Order #$it is placed.")
        return
    }
    val discount = store.subtotal * store.discount / 100.0
    Text("Order", style = MaterialTheme.typography.titleSmall)
    Text("Subtotal: $${store.subtotal}.00")
    if (store.discount > 0) Text("Coupon: -" + money(discount))
    Text("Shipping: " + if (store.shipping == 0) "Free" else "$${store.shipping}.00")
    Text("Order total: " + money(store.subtotal - discount + store.shipping), style = MaterialTheme.typography.titleMedium)
    HorizontalDivider()
    Text("Shipping address", style = MaterialTheme.typography.titleSmall)
    OutlinedTextField(name, { name = it }, label = { Text("Full name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(address, { address = it }, label = { Text("Street address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(
        zip, { zip = it }, label = { Text("ZIP code") }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(),
    )
    error?.let { Text(it, color = Color.Red) }
    Button(onClick = {
        error = when {
            name.isBlank() || address.isBlank() -> "Please enter your name and address."
            zip.length != 5 || !zip.all { it.isDigit() } -> "ZIP code must be 5 digits."
            else -> null
        }
        if (error == null) placed = store.placeOrder()
    }) { Text("Place order") }
}

@Composable
fun Signup() {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var welcome by remember { mutableStateOf<String?>(null) }

    welcome?.let {
        Text(it)
        return
    }
    OutlinedTextField(
        email, { email = it }, label = { Text("Email") }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false),
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
        password, { password = it }, label = { Text("Password") }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth(),
    )
    error?.let { Text(it, color = Color.Red) }
    Button(onClick = {
        val e = email.trim()
        // BUG signup-email-validation: only checks the field isn't empty.
        val valid = if (Bugs.on(Bug.SignupEmailValidation)) e.isNotEmpty() else Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(e)
        error = when {
            !valid -> "Please enter a valid email address."
            password.length < 8 -> "Password must be at least 8 characters."
            else -> null
        }
        if (error == null) welcome = "Welcome, $e! Your account was created."
    }) { Text("Create account") }
}
