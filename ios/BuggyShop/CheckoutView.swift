import SwiftUI

struct CheckoutView: View {
    @EnvironmentObject var store: Store
    @State private var name = ""
    @State private var address = ""
    @State private var zip = ""
    @State private var error: String?
    @State private var placed: Int?

    var body: some View {
        List {
            if let placed {
                // String(_:) so the number isn't formatted with a thousands separator ("#1,001").
                Text("Thank you! Order #\(String(placed)) is placed.")
            } else {
                Section("Order") {
                    let discount = Double(store.subtotal) * Double(store.discount) / 100
                    LabeledContent("Subtotal", value: "$\(store.subtotal).00")
                    if store.discount > 0 {
                        LabeledContent("Coupon", value: String(format: "-$%.2f", discount))
                    }
                    LabeledContent("Shipping", value: store.shipping == 0 ? "Free" : "$\(store.shipping).00")
                    LabeledContent("Order total",
                                   value: String(format: "$%.2f", Double(store.subtotal) - discount + Double(store.shipping)))
                }
                Section("Shipping address") {
                    TextField("Full name", text: $name)
                    TextField("Street address", text: $address)
                    TextField("ZIP code", text: $zip).keyboardType(.numberPad)
                    if let error { Text(error).foregroundStyle(.red) }
                    Button("Place order") { place() }
                }
            }
        }
        .navigationTitle("Checkout")
    }

    private func place() {
        error = nil
        if name.trimmingCharacters(in: .whitespaces).isEmpty || address.trimmingCharacters(in: .whitespaces).isEmpty {
            error = "Please enter your name and address."
            return
        }
        if zip.count != 5 || !zip.allSatisfy(\.isNumber) {
            error = "ZIP code must be 5 digits."
            return
        }
        placed = store.placeOrder()
    }
}
