import SwiftUI

struct SignupView: View {
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var welcome: String?

    var body: some View {
        Form {
            if let welcome {
                Text(welcome)
            } else {
                TextField("Email", text: $email)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                SecureField("Password", text: $password)
                if let error { Text(error).foregroundStyle(.red) }
                Button("Create account") { submit() }
            }
        }
        .navigationTitle("Sign up")
    }

    private func submit() {
        error = nil
        let e = email.trimmingCharacters(in: .whitespaces)
        // BUG signup-email-validation: only checks the field isn't empty.
        let valid = Bugs.on(.signupEmailValidation)
            ? !e.isEmpty
            : e.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
        if !valid {
            error = "Please enter a valid email address."
            return
        }
        if password.count < 8 {
            error = "Password must be at least 8 characters."
            return
        }
        welcome = "Welcome, \(e)! Your account was created."
    }
}
