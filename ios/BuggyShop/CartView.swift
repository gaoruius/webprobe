import SwiftUI

struct CartView: View {
    @EnvironmentObject var store: Store
    @State private var code = ""
    @State private var message: String?

    var body: some View {
        List {
            if store.lines.isEmpty {
                Text("Your cart is empty.")
            } else {
                Section("Items") {
                    ForEach(store.lines) { line in
                        Stepper(value: Binding(get: { line.shownQty }, set: { store.setQuantity(line.id, $0) }),
                                in: 0...99) {
                            Text("\(line.product.name), $\(line.product.price), quantity \(line.shownQty)")
                        }
                    }
                }
                Section("Coupon") {
                    TextField("Coupon code", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    Button("Apply") { apply() }
                    if let message { Text(message) }
                }
                Section {
                    let total = Double(store.subtotal) * (1 - Double(store.discount) / 100)
                    Text("Total: $\(String(format: "%.2f", total))").font(.headline)
                    Text("Free shipping when your items come to more than $\(freeShippingOver).")
                        .foregroundStyle(.secondary)
                    NavigationLink("Checkout") { CheckoutView() }
                }
            }
        }
        .navigationTitle("Cart")
    }

    private func apply() {
        message = nil
        // BUG coupon-silent: the coupon service is "down" and the failure is swallowed: no
        // discount and no message. Correct: valid codes apply, anything else shows an error.
        if Bugs.on(.couponSilent) { return }
        if let off = coupons[code.trimmingCharacters(in: .whitespaces).uppercased()] {
            store.discount = off
            message = "Coupon applied: \(off)% off"
        } else {
            message = "This coupon code is not valid."
        }
    }
}
