import SwiftUI

struct ProductDetailView: View {
    @EnvironmentObject var store: Store
    let product: Product
    @State private var tab = "Description"
    @State private var added = false

    var body: some View {
        List {
            Section {
                Text("$\(product.price)").font(.title2)
                Button(added ? "Added" : "Add to cart") {
                    store.add(product)
                    added = true
                }
            }
            Section {
                Picker("Details", selection: $tab) {
                    Text("Description").tag("Description")
                    Text("Reviews (\(product.reviews.count))").tag("Reviews")
                }
                .pickerStyle(.segmented)
                if tab == "Description" {
                    Text(product.description)
                } else {
                    ReviewsView(reviews: product.reviews)
                }
            }
        }
        .navigationTitle(product.name)
    }
}

struct ReviewsView: View {
    let reviews: [Review]

    var body: some View {
        // BUG reviews-crash: reads the first review before checking there is one, so a product
        // with no reviews crashes the app (index out of range).
        if Bugs.on(.reviewsCrash) {
            let first = reviews[0]
            Text("Top review by \(first.author)")
        } else if reviews.isEmpty {
            Text("No reviews yet.")
        }
        ForEach(reviews, id: \.self) { r in
            VStack(alignment: .leading) {
                Text("\(r.author) – \(String(repeating: "★", count: r.rating))")
                Text(r.text).foregroundStyle(.secondary)
            }
        }
    }
}
