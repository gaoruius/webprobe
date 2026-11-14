import SwiftUI

enum SortOrder: String, CaseIterable, Identifiable {
    case featured = "Featured"
    case lowToHigh = "Price: low to high"
    case highToLow = "Price: high to low"
    var id: String { rawValue }
}

struct ProductListView: View {
    @EnvironmentObject var store: Store
    @State private var query = ""
    @State private var sort = SortOrder.featured

    private var shown: [Product] {
        let q = query.trimmingCharacters(in: .whitespaces)
        // BUG search-case-sensitive: "mug" finds nothing, "Mug" finds the Ceramic Mug.
        let matching = products.filter { p in
            q.isEmpty || (Bugs.on(.searchCaseSensitive) ? p.name.contains(q) : p.name.localizedCaseInsensitiveContains(q))
        }
        if sort == .featured { return matching }
        // BUG sort-price-string: compares prices as text, so $9 sorts after $39.
        let asc = matching.sorted { a, b in
            Bugs.on(.sortPriceString) ? String(a.price) < String(b.price) : a.price < b.price
        }
        return sort == .lowToHigh ? asc : asc.reversed()
    }

    var body: some View {
        List {
            Section {
                Picker("Sort by", selection: $sort) {
                    ForEach(SortOrder.allCases) { Text($0.rawValue).tag($0) }
                }
            }
            Section {
                if shown.isEmpty {
                    Text("No products match \u{201C}\(query)\u{201D}.")
                }
                ForEach(shown) { product in
                    HStack {
                        NavigationLink(value: product) {
                            HStack(spacing: 12) {
                                Image(systemName: product.symbol)
                                    .font(.title2)
                                    .frame(width: 36)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading) {
                                    Text(product.name).font(.headline)
                                    Text("$\(product.price)").foregroundStyle(.secondary)
                                }
                            }
                        }
                        AddButton(product: product)
                    }
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search products")
        .navigationTitle("Products")
        .navigationDestination(for: Product.self) { ProductDetailView(product: $0) }
    }
}

struct AddButton: View {
    @EnvironmentObject var store: Store
    let product: Product

    var body: some View {
        Button {
            store.add(product)
        } label: {
            Image(systemName: "plus.circle.fill")
                .font(.title2)
                .accessibilityHidden(true)
        }
        .buttonStyle(.borderless)
        // BUG add-button-unlabeled: an icon-only button with no accessibility label, so
        // VoiceOver (and the accessibility tree) has nothing to call it.
        .accessibilityLabel(Bugs.on(.addButtonUnlabeled) ? "" : "Add \(product.name) to cart")
    }
}
