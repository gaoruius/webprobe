package dev.webprobe.buggyshop

// Bug switches, like ios/BuggyShop/Bugs.swift. android-mcp starts the app with a BUGS extra:
// missing or "all" turns every bug on, "none" gives the clean app, or a comma-separated list of ids.
enum class Bug(val id: String) {
    CartZeroQty("cart-zero-qty"),
    SearchCaseSensitive("search-case-sensitive"),
    SortPriceString("sort-price-string"),
    SignupEmailValidation("signup-email-validation"),
    CheckoutFreeShipping("checkout-free-shipping"),
    CouponSilent("coupon-silent"),
    ReviewsCrash("reviews-crash"),
    AddButtonUnlabeled("add-button-unlabeled"),
}

object Bugs {
    private var enabled: Set<String> = Bug.entries.map { it.id }.toSet()

    fun configure(raw: String?) {
        enabled = when (val r = raw?.trim() ?: "all") {
            "all" -> Bug.entries.map { it.id }.toSet()
            "none" -> emptySet()
            else -> r.split(",").map { it.trim() }.toSet()
        }
    }

    fun on(bug: Bug) = bug.id in enabled
}
