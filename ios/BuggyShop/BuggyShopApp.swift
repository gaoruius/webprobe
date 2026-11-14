import SwiftUI

@main
struct BuggyShopApp: App {
    @StateObject private var store = Store()

    var body: some Scene {
        WindowGroup {
            TabView {
                NavigationStack { ProductListView() }
                    .tabItem { Label("Products", systemImage: "bag") }
                NavigationStack { CartView() }
                    .tabItem { Label("Cart", systemImage: "cart") }
                    .badge(store.count)
                NavigationStack { SignupView() }
                    .tabItem { Label("Sign up", systemImage: "person") }
            }
            .environmentObject(store)
        }
    }
}
