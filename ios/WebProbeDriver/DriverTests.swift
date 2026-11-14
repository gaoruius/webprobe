// WebProbeDriver: a tiny XCUITest-based driver, the same idea as WebDriverAgent (what Appium uses
// underneath). One long-running UI test starts an HTTP server on 127.0.0.1:8100; ios-mcp sends it
// commands. The simulator shares the Mac's network, so the server is reachable from the Mac.
//
//   POST /launch     {"bugs": "all"}       (re)launch BuggyShop with those bugs on
//   GET  /snapshot                          the app's accessibility tree, with refs like [ref=e5]
//   POST /tap        {"ref": "e5"}
//   POST /type       {"ref": "e5", "text": "…"}   replaces the field's text
//   POST /swipe      {"direction": "up"}   scroll the screen
//   GET  /screenshot                        PNG, base64
//   POST /quit                              end the test (and the server)
//
// XCUITest calls must run on the main thread, so requests are queued and the test method runs
// them while it spins the main run loop.

import Network
import XCTest

final class DriverTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "dev.webprobe.BuggyShop")
    // What the last snapshot said about each ref, to find the element again when the agent acts.
    private struct Seen {
        let type: XCUIElement.ElementType
        let label: String
        let placeholder: String
        let frame: CGRect
    }
    private var seen: [String: Seen] = [:]
    private var done = false

    func testServe() throws {
        continueAfterFailure = true
        let port = UInt16(ProcessInfo.processInfo.environment["WEBPROBE_DRIVER_PORT"] ?? "8100") ?? 8100
        let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
        listener.newConnectionHandler = { [weak self] conn in self?.serve(conn) }
        listener.start(queue: .global())
        print("WebProbeDriver listening on \(port)")
        while !done {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        listener.cancel()
    }

    // MARK: HTTP

    private func serve(_ conn: NWConnection) {
        conn.start(queue: .global())
        receive(conn, buffer: Data())
    }

    // Read until the headers and the declared body have arrived, then handle the request.
    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, complete, error in
            guard let self else { return }
            var buf = buffer
            if let data { buf.append(data) }
            if let request = Request(buf) {
                DispatchQueue.main.async {
                    let (status, body) = self.handle(request)
                    self.respond(conn, status: status, body: body)
                }
            } else if !complete && error == nil {
                self.receive(conn, buffer: buf)
            } else {
                conn.cancel()
            }
        }
    }

    private func respond(_ conn: NWConnection, status: Int, body: String) {
        let payload = Data(body.utf8)
        let head = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "Error")\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: \(payload.count)\r\nConnection: close\r\n\r\n"
        conn.send(content: Data(head.utf8) + payload, completion: .contentProcessed { _ in conn.cancel() })
    }

    // MARK: Commands

    private func handle(_ req: Request) -> (Int, String) {
        switch (req.method, req.path) {
        case ("POST", "/launch"):
            app.terminate()
            app.launchEnvironment["BUGS"] = req.json["bugs"] ?? "all"
            app.launch()
            return (200, "Launched BuggyShop.")
        case ("GET", "/snapshot"):
            return snapshot()
        case ("POST", "/tap"):
            let ref = req.json["ref"] ?? ""
            guard let info = seen[ref] else { return (400, staleRef(ref)) }
            // Tap the element itself, so XCUITest scrolls it clear of the keyboard first; fall back
            // to the snapshot's coordinates for elements it can't find again.
            if let el = element(info), el.isHittable {
                el.tap()
            } else {
                point(info).tap()
            }
            return (200, "Tapped \(ref). Call snapshot to see the result.\(stateNote())")
        case ("POST", "/type"):
            let ref = req.json["ref"] ?? ""
            guard let info = seen[ref] else { return (400, staleRef(ref)) }
            let el = element(info)
            if let el { el.tap() } else { point(info).tap() }
            // Never type into a field the agent didn't pick: a tap that lands on the keyboard or a
            // neighbouring field would silently put the text somewhere else.
            let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
            guard focused.exists, focused.elementType == info.type,
                  (focused.placeholderValue ?? "") == info.placeholder, focused.label == info.label else {
                return (409, "Could not put the cursor in \(ref). Take a new snapshot; if the field is hidden, swipe to it.")
            }
            // Replace what's there: select all isn't reliable in every field, so delete instead.
            if let old = focused.value as? String, !old.isEmpty, old != focused.placeholderValue {
                app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
            }
            app.typeText(req.json["text"] ?? "")
            return (200, "Typed into \(ref). Call snapshot to see the result.\(stateNote())")
        case ("POST", "/swipe"):
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            let dy: CGFloat = req.json["direction"] == "down" ? 0.3 : -0.3
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: dy * app.frame.height)))
            return (200, "Swiped \(req.json["direction"] ?? "up"). Call snapshot to see the result.\(stateNote())")
        case ("GET", "/screenshot"):
            return (200, XCUIScreen.main.screenshot().pngRepresentation.base64EncodedString())
        case ("POST", "/quit"):
            done = true
            return (200, "Bye.")
        default:
            return (404, "Unknown command \(req.method) \(req.path)")
        }
    }

    // The app's accessibility tree as indented lines, like the web snapshot:
    //   - button "Add Ceramic Mug to cart" [ref=e7]
    private func snapshot() -> (Int, String) {
        if app.state != .runningForeground {
            return (200, "The app is not running: it crashed or was closed. Relaunch it to continue.")
        }
        guard let root = try? app.snapshot() else { return (500, "Could not read the app's accessibility tree.") }
        seen = [:]
        var lines: [String] = []
        var n = 0
        // Screens the user navigated away from stay in the hierarchy, moved off screen. Leave them
        // out, or the agent sees two pages at once.
        let screen = root.frame
        func walk(_ el: XCUIElementSnapshot, depth: Int) {
            if !el.frame.isEmpty && !el.frame.intersects(screen) { return }
            let type = typeName(el.elementType)
            let named = !el.label.isEmpty || !(el.identifier.isEmpty)
            let interesting = interactive(el.elementType) || (!el.label.isEmpty && type != "other")
            var nextDepth = depth
            if interesting && !el.frame.isEmpty {
                n += 1
                let ref = "e\(n)"
                seen[ref] = Seen(type: el.elementType, label: el.label, placeholder: el.placeholderValue ?? "", frame: el.frame)
                var line = String(repeating: "  ", count: depth) + "- \(type)"
                if named {
                    line += " \"\(el.label.isEmpty ? el.identifier : el.label)\""
                } else if let placeholder = el.placeholderValue, !placeholder.isEmpty {
                    // SwiftUI text fields carry their title as a placeholder, not a label.
                    line += " placeholder=\"\(placeholder)\""
                } else {
                    line += " (no label)"
                }
                if let v = el.value as? String, !v.isEmpty, v != el.label { line += " value=\"\(v)\"" }
                if !el.isEnabled { line += " [disabled]" }
                if el.isSelected { line += " [selected]" }
                line += " [ref=\(ref)]"
                lines.append(line)
                nextDepth = depth + 1
            }
            for child in el.children { walk(child, depth: nextDepth) }
        }
        walk(root, depth: 0)
        return (200, "Screen: \(app.navigationBars.firstMatch.identifier)\n\n" + lines.joined(separator: "\n"))
    }

    private func point(_ info: Seen) -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: info.frame.midX, dy: info.frame.midY))
    }

    // The live element a ref stood for: same type, label and placeholder, nearest to where it was.
    private func element(_ info: Seen) -> XCUIElement? {
        let matches = app.descendants(matching: info.type).allElementsBoundByIndex.filter {
            $0.label == info.label && ($0.placeholderValue ?? "") == info.placeholder
        }
        func distance(_ el: XCUIElement) -> CGFloat {
            hypot(el.frame.midX - info.frame.midX, el.frame.midY - info.frame.midY)
        }
        return matches.min { distance($0) < distance($1) }
    }

    private func staleRef(_ ref: String?) -> String {
        "No element \(ref ?? "") in the last snapshot. Take a new snapshot and use its refs."
    }

    private func stateNote() -> String {
        app.state == .runningForeground ? "" : "\nThe app is no longer running: it crashed or was closed."
    }

    private func interactive(_ t: XCUIElement.ElementType) -> Bool {
        [.button, .textField, .secureTextField, .searchField, .link, .cell, .switch, .stepper,
         .segmentedControl, .tab, .slider, .picker, .pickerWheel, .menuItem, .incrementArrow, .decrementArrow]
            .contains(t)
    }

    private func typeName(_ t: XCUIElement.ElementType) -> String {
        switch t {
        case .button: return "button"
        case .staticText: return "text"
        case .textField: return "textField"
        case .secureTextField: return "secureTextField"
        case .searchField: return "searchField"
        case .cell: return "cell"
        case .navigationBar: return "navigationBar"
        case .tabBar: return "tabBar"
        case .tab: return "tab"
        case .stepper: return "stepper"
        case .segmentedControl: return "segmentedControl"
        case .switch: return "switch"
        case .image: return "image"
        case .link: return "link"
        case .alert: return "alert"
        case .picker, .pickerWheel: return "picker"
        case .menuItem: return "menuItem"
        default: return "other"
        }
    }
}

// Just enough HTTP/1.1 parsing for this driver: method, path, and a flat JSON object body.
private struct Request {
    let method: String
    let path: String
    let json: [String: String]

    init?(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8), let split = text.range(of: "\r\n\r\n") else { return nil }
        let head = text[..<split.lowerBound]
        let body = String(text[split.upperBound...])
        let lines = head.split(separator: "\r\n")
        let first = lines.first?.split(separator: " ") ?? []
        guard first.count >= 2 else { return nil }
        let length = lines.compactMap { line -> Int? in
            let parts = line.split(separator: ":", maxSplits: 1)
            return parts.count == 2 && parts[0].lowercased() == "content-length"
                ? Int(parts[1].trimmingCharacters(in: .whitespaces)) : nil
        }.first ?? 0
        guard body.utf8.count >= length else { return nil }
        method = String(first[0])
        path = String(first[1])
        let obj = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any] ?? [:]
        json = obj.compactMapValues { $0 as? String }
    }
}
