import Foundation

// Bug switches, like buggyshop/lib/bugs.ts. The driver launches the app with BUGS in its
// environment: unset or "all" turns every bug on, "none" gives the clean app, or a list of ids.
enum Bug: String, CaseIterable {
    case cartZeroQty = "cart-zero-qty"
    case searchCaseSensitive = "search-case-sensitive"
    case sortPriceString = "sort-price-string"
    case signupEmailValidation = "signup-email-validation"
    case checkoutFreeShipping = "checkout-free-shipping"
    case couponSilent = "coupon-silent"
    case reviewsCrash = "reviews-crash"
    case addButtonUnlabeled = "add-button-unlabeled"
}

enum Bugs {
    static let enabled: Set<String> = {
        let raw = (ProcessInfo.processInfo.environment["BUGS"] ?? "all").trimmingCharacters(in: .whitespaces)
        if raw == "all" { return Set(Bug.allCases.map(\.rawValue)) }
        if raw == "none" { return [] }
        return Set(raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) })
    }()

    static func on(_ bug: Bug) -> Bool { enabled.contains(bug.rawValue) }
}
