import Foundation
import SwiftUI

struct Review: Hashable {
    let author: String
    let rating: Int
    let text: String
}

struct Product: Identifiable, Hashable {
    let id: String
    let name: String
    let price: Int
    let symbol: String
    let description: String
    let reviews: [Review]
}

let products: [Product] = [
    Product(id: "mug", name: "Ceramic Mug", price: 14, symbol: "cup.and.saucer",
            description: "A 350 ml stoneware mug. Dishwasher safe.",
            reviews: [Review(author: "Lin", rating: 5, text: "Keeps coffee warm for ages."),
                      Review(author: "Sam", rating: 4, text: "Nice glaze, a bit heavy.")]),
    Product(id: "notebook", name: "Dot Grid Notebook", price: 9, symbol: "book.closed",
            description: "A5, 160 pages, lay-flat binding.",
            reviews: [Review(author: "Ana", rating: 5, text: "Fountain pen friendly.")]),
    Product(id: "lamp", name: "Desk Lamp", price: 39, symbol: "lamp.desk",
            description: "Dimmable LED desk lamp with USB-C power.",
            reviews: []),
]

struct CartLine: Identifiable {
    let product: Product
    // What the total uses, and what the stepper shows. They differ only with cart-zero-qty on.
    var qty: Int
    var shownQty: Int
    var id: String { product.id }
}

let shippingFee = 5
let freeShippingOver = 50
let coupons = ["SAVE10": 10, "WELCOME20": 20]

@MainActor
final class Store: ObservableObject {
    @Published var lines: [CartLine] = []
    @Published var discount = 0
    @Published var lastOrder: Int?

    var count: Int { lines.reduce(0) { $0 + $1.shownQty } }
    var subtotal: Int { lines.reduce(0) { $0 + $1.product.price * $1.qty } }

    var shipping: Int {
        // BUG checkout-free-shipping: compares the number of items, not their price.
        let over = Bugs.on(.checkoutFreeShipping) ? count > freeShippingOver : subtotal > freeShippingOver
        return over ? 0 : shippingFee
    }

    func add(_ product: Product) {
        if let i = lines.firstIndex(where: { $0.id == product.id }) {
            lines[i].qty += 1
            lines[i].shownQty = lines[i].qty
        } else {
            lines.append(CartLine(product: product, qty: 1, shownQty: 1))
        }
    }

    func setQuantity(_ id: String, _ qty: Int) {
        guard let i = lines.firstIndex(where: { $0.id == id }) else { return }
        if qty <= 0 {
            // BUG cart-zero-qty: the stepper shows 0 but the item stays and keeps its old
            // quantity in the total. Correct: remove the line.
            if Bugs.on(.cartZeroQty) {
                lines[i].shownQty = 0
            } else {
                lines.remove(at: i)
            }
            return
        }
        lines[i].qty = qty
        lines[i].shownQty = qty
    }

    func placeOrder() -> Int {
        let number = 1001 + (lastOrder.map { $0 - 1000 } ?? 0)
        lastOrder = number
        lines = []
        discount = 0
        return number
    }
}
