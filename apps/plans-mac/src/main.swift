// The Plans Mac app: one window that shows the dashboard page, plus the ⌘ menu keys that a browser keeps for itself.
// Plain AppKit + WebKit. Build it with `npm run build-app` (apps/plans-mac/build.mjs).
// The menu calls the page only through its window.dashboard hooks (apps/dashboard/page/app.js).
// Closing the window hides it: the page stays loaded, and runs and chats never stop (they run under the server).
import AppKit
import WebKit

/// The dashboard URL that build.mjs wrote into Info.plist, else https://plans.test.
let appURL: URL = {
  let s = Bundle.main.object(forInfoDictionaryKey: "PlansURL") as? String ?? "https://plans.test"
  return URL(string: s) ?? URL(string: "https://plans.test")!
}()

/// Gives the origin of a URL as scheme, host and port (443 when an https URL has no port, 80 for http).
func origin(_ url: URL?) -> (String, String, Int)? {
  guard let url = url, let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
  let port = url.port ?? (scheme == "https" ? 443 : scheme == "http" ? 80 : -1)
  return (scheme, host, port)
}

let appOrigin = origin(appURL)

/// True when the URL has the app's origin: the same scheme, host and port.
func sameOrigin(_ url: URL?) -> Bool {
  guard let a = appOrigin, let b = origin(url) else { return false }
  return a.0 == b.0 && a.1 == b.1 && a.2 == b.2
}

/// Escapes text for an HTML page.
func htmlEscape(_ s: String) -> String {
  return s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
    .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
  var window: NSWindow!
  var web: WKWebView!
  /// The one retry timer of the waiting page.
  var retry: Timer?
  /// The URL that the waiting page loads again: the failed URL when it has the app's origin, else appURL.
  var retryURL: URL?

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Plans"
    window.minSize = NSSize(width: 800, height: 500)
    window.isReleasedWhenClosed = false
    window.center()
    window.setFrameAutosaveName("PlansMain")
    window.delegate = self

    // the default websiteDataStore is the persistent one: localStorage (tabs, settings) survives a quit
    let config = WKWebViewConfiguration()
    // the macOS 14 SDK (Swift 5.9) has inactiveSchedulingPolicy; an older SDK cannot compile the line, also under #available
    #if compiler(>=5.9)
    if #available(macOS 14.0, *) {
      // a hidden window keeps the page's timers (the /api/state poll, the 🔔 sound) at full speed
      config.preferences.inactiveSchedulingPolicy = .none
    }
    #endif
    web = WKWebView(frame: window.contentView?.bounds ?? .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    window.contentView = web
    // the keys go to the page from the start, so ⌘K and ⌘L can put the cursor in a box before the first click
    window.initialFirstResponder = web
    web.load(URLRequest(url: appURL))
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  // 2A: the red button and ⇧⌘W hide the window; the page stays loaded, and only ⌘Q quits
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    window.orderOut(nil)
    return false
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return false
  }

  // a Dock click shows the window again
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if window.isMiniaturized { window.deminiaturize(nil) }
    window.makeKeyAndOrderFront(nil)
    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    retry?.invalidate()
    retry = nil
  }

  // --- the menu bar

  /// Calls one window.dashboard hook, only while the window is on screen and the web view shows the app's origin.
  /// A hidden window gets no call: ⌘W after ⇧⌘W must not close a tab that nobody sees.
  func call(_ js: String) {
    guard window.isVisible, sameOrigin(web.url) else { return }
    web.evaluateJavaScript("window.dashboard && window.dashboard." + js, completionHandler: nil)
  }

  @objc func settings(_ sender: Any?) { call("openSettings()") }
  @objc func board(_ sender: Any?) { call("toggleBoard()") }
  @objc func palette(_ sender: Any?) { call("openSearch()") }
  @objc func chatBox(_ sender: Any?) { call("focusChat()") }
  @objc func tab1(_ sender: Any?) { call("switchSession(1)") }
  @objc func tab2(_ sender: Any?) { call("switchSession(2)") }
  @objc func tab3(_ sender: Any?) { call("switchSession(3)") }
  @objc func tab4(_ sender: Any?) { call("switchSession(4)") }
  @objc func tab5(_ sender: Any?) { call("switchSession(5)") }
  @objc func tab6(_ sender: Any?) { call("switchSession(6)") }
  @objc func tab7(_ sender: Any?) { call("switchSession(7)") }
  @objc func tab8(_ sender: Any?) { call("switchSession(8)") }
  @objc func lastTab(_ sender: Any?) { call("switchSession(9)") }
  @objc func prevTab(_ sender: Any?) { call("nextSession(-1)") }
  @objc func nextTab(_ sender: Any?) { call("nextSession(1)") }
  @objc func closeTab(_ sender: Any?) { call("closeSession()") }
  @objc func reopenTab(_ sender: Any?) { call("reopenSession()") }

  /// Reloads the dashboard; on the waiting page it loads the URL that failed.
  @objc func reload(_ sender: Any?) {
    if sameOrigin(web.url) { web.reload() } else { web.load(URLRequest(url: retryURL ?? appURL)) }
  }

  /// Adds one menu item with this delegate as its target.
  func item(_ menu: NSMenu, _ it: NSMenuItem) {
    if it.target == nil && it.action != nil && responds(to: it.action!) { it.target = self }
    menu.addItem(it)
  }

  func buildMenu() {
    let bar = NSMenu()

    let appMenu = NSMenu(title: "Plans")
    item(appMenu, NSMenuItem(title: "About Plans", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
    appMenu.addItem(.separator())
    item(appMenu, NSMenuItem(title: "Settings…", action: #selector(settings(_:)), keyEquivalent: ","))
    appMenu.addItem(.separator())
    item(appMenu, NSMenuItem(title: "Hide Plans", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
    let others = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    others.keyEquivalentModifierMask = [.command, .option]
    item(appMenu, others)
    appMenu.addItem(.separator())
    item(appMenu, NSMenuItem(title: "Quit Plans", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

    // the standard selectors go to the first responder, so text boxes get the keys
    let edit = NSMenu(title: "Edit")
    item(edit, NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
    item(edit, NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"))
    edit.addItem(.separator())
    item(edit, NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
    item(edit, NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
    item(edit, NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
    item(edit, NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))

    let view = NSMenu(title: "View")
    item(view, NSMenuItem(title: "Board", action: #selector(board(_:)), keyEquivalent: "b"))
    item(view, NSMenuItem(title: "Command Palette", action: #selector(palette(_:)), keyEquivalent: "k"))
    item(view, NSMenuItem(title: "Chat Box", action: #selector(chatBox(_:)), keyEquivalent: "l"))
    view.addItem(.separator())
    item(view, NSMenuItem(title: "Reload", action: #selector(reload(_:)), keyEquivalent: "r"))

    // ⇧⌘[ and ⇧⌘] are the key equivalents "{" and "}": Shift is implied
    let tabs = NSMenu(title: "Tabs")
    item(tabs, NSMenuItem(title: "Tab 1", action: #selector(tab1(_:)), keyEquivalent: "1"))
    item(tabs, NSMenuItem(title: "Tab 2", action: #selector(tab2(_:)), keyEquivalent: "2"))
    item(tabs, NSMenuItem(title: "Tab 3", action: #selector(tab3(_:)), keyEquivalent: "3"))
    item(tabs, NSMenuItem(title: "Tab 4", action: #selector(tab4(_:)), keyEquivalent: "4"))
    item(tabs, NSMenuItem(title: "Tab 5", action: #selector(tab5(_:)), keyEquivalent: "5"))
    item(tabs, NSMenuItem(title: "Tab 6", action: #selector(tab6(_:)), keyEquivalent: "6"))
    item(tabs, NSMenuItem(title: "Tab 7", action: #selector(tab7(_:)), keyEquivalent: "7"))
    item(tabs, NSMenuItem(title: "Tab 8", action: #selector(tab8(_:)), keyEquivalent: "8"))
    item(tabs, NSMenuItem(title: "Last Tab", action: #selector(lastTab(_:)), keyEquivalent: "9"))
    tabs.addItem(.separator())
    item(tabs, NSMenuItem(title: "Previous Tab", action: #selector(prevTab(_:)), keyEquivalent: "{"))
    item(tabs, NSMenuItem(title: "Next Tab", action: #selector(nextTab(_:)), keyEquivalent: "}"))
    tabs.addItem(.separator())
    item(tabs, NSMenuItem(title: "Close Tab", action: #selector(closeTab(_:)), keyEquivalent: "w"))
    item(tabs, NSMenuItem(title: "Reopen Closed Tab", action: #selector(reopenTab(_:)), keyEquivalent: "T"))

    let win = NSMenu(title: "Window")
    item(win, NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
    item(win, NSMenuItem(title: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "W"))

    for m in [appMenu, edit, view, tabs, win] {
      let top = NSMenuItem(title: m.title, action: nil, keyEquivalent: "")
      top.submenu = m
      bar.addItem(top)
    }
    NSApp.mainMenu = bar
    NSApp.windowsMenu = win
  }

  // --- links: only the app's origin stays in the window

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.allow) }
    // the app's own waiting page and page parts
    if scheme == "about" || scheme == "data" || scheme == "blob" { return decisionHandler(.allow) }
    // vscode:, mailto: and the other apps' schemes
    if scheme != "http" && scheme != "https" {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel)
    }
    if navigationAction.targetFrame?.isMainFrame == true && !sameOrigin(url) {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  // target="_blank" and window.open go to the default browser
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    guard navigationResponse.isForMainFrame else { return decisionHandler(.allow) }
    let url = navigationResponse.response.url
    // Caddy answers 502, 503 or 504 while the dashboard service is down or restarts
    if let http = navigationResponse.response as? HTTPURLResponse, sameOrigin(url),
       [502, 503, 504].contains(http.statusCode) {
      decisionHandler(.cancel)
      showWaiting(for: url ?? appURL, certificate: false)
      return
    }
    // a file the web view cannot show (a download) opens in the default browser
    if !navigationResponse.canShowMIMEType, let url = url {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  // --- the waiting page

  /// Shows "Waiting for the dashboard…" and loads the URL again after 5 s (one timer only).
  func showWaiting(for url: URL, certificate: Bool) {
    retryURL = sameOrigin(url) ? url : appURL
    let hint = certificate ? "<p>Run <code>caddy trust</code> (scripts/setup-macos.sh does it).</p>" : ""
    let page = """
    <!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>
    body { font: 15px -apple-system, sans-serif; display: flex; align-items: center; justify-content: center;
      height: 100vh; margin: 0; background: #fff; color: #222; }
    @media (prefers-color-scheme: dark) { body { background: #1e1e1e; color: #ddd; } }
    main { text-align: center; } code { font: 13px ui-monospace, monospace; }
    </style></head><body><main><p>Waiting for the dashboard at <code>\(htmlEscape(appURL.absoluteString))</code>…</p>
    \(hint)</main></body></html>
    """
    web.loadHTMLString(page, baseURL: nil)
    retry?.invalidate()
    retry = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
      guard let self = self else { return }
      self.web.load(URLRequest(url: self.retryURL ?? appURL))
    }
  }

  /// Shows the waiting page for a connection or certificate error; a cancelled load (-999) keeps the page.
  func failed(_ error: Error) {
    let e = error as NSError
    guard e.domain == NSURLErrorDomain, e.code != NSURLErrorCancelled else { return }
    let url = e.userInfo[NSURLErrorFailingURLErrorKey] as? URL ?? appURL
    // -1206 … -1200: NSURLErrorClientCertificateRequired … NSURLErrorSecureConnectionFailed
    showWaiting(for: url, certificate: (-1206 ... -1200).contains(e.code))
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if sameOrigin(webView.url) {
      retry?.invalidate(); retry = nil
    }
  }

  // --- the page's alert() and confirm() as native panels

  /// Shows the hidden window before a panel: a sheet on a hidden window waits unseen, and the page's script waits with it.
  func showForPanel() {
    if window.isMiniaturized { window.deminiaturize(nil) }
    if !window.isVisible { window.makeKeyAndOrderFront(nil) }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    showForPanel()
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "OK")
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    showForPanel()
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Cancel")
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
  }
}

let app = NSApplication.shared
// a top-level let: NSApplication.delegate is weak
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
