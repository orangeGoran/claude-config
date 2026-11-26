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

/// The page zoom steps of ⌘+ and ⌘−, as in Safari.
let zoomSteps: [CGFloat] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/// Gives the next zoom step up (+1) or down (−1) from a zoom, inside zoomSteps.
func nextZoom(_ zoom: CGFloat, _ dir: Int) -> CGFloat {
  if dir > 0 { return zoomSteps.first { $0 > zoom + 0.001 } ?? zoomSteps.last! }
  return zoomSteps.last { $0 < zoom - 0.001 } ?? zoomSteps.first!
}

/// The height of the page's header row in points at zoom 1 (header.mainhd in apps/dashboard/page/app.css).
let headerHeight: CGFloat = 40
/// The left padding that the header needs in points, so its buttons start right of the window buttons.
let headerInset: CGFloat = 80

/// A web view that keeps its last mouse-down, so the page can start a window drag from its header.
final class PageView: WKWebView {
  var lastMouseDown: NSEvent?
  override func mouseDown(with event: NSEvent) {
    lastMouseDown = event
    super.mouseDown(with: event)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  var window: NSWindow!
  var web: PageView!
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
    // the page posts "drag" (a mouse-down on an empty part of its header) and "zoom" (a double-click there)
    config.userContentController.add(self, name: "plans")
    web = PageView(frame: window.contentView?.bounds ?? .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.pageZoom = savedZoom()
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

  // the title bar puts the window buttons back after a resize and after full screen
  func windowDidResize(_ notification: Notification) { placeWindowButtons() }
  func windowDidEnterFullScreen(_ notification: Notification) { tellPageInset() }
  func windowDidExitFullScreen(_ notification: Notification) { placeWindowButtons(); tellPageInset() }

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

  // --- the title bar: the window buttons in the page's header row

  /// Makes the page's header row the title bar (on), or shows the normal title bar (off).
  /// It is on only for a dashboard page that has the macInset() hook: a page without it (the waiting page,
  /// an older dashboard) has no header to drag the window by.
  func headerTitleBar(_ on: Bool) {
    if on { window.styleMask.insert(.fullSizeContentView) } else { window.styleMask.remove(.fullSizeContentView) }
    window.titlebarAppearsTransparent = on
    window.titleVisibility = on ? .hidden : .visible
    placeWindowButtons()
  }

  /// Puts the close, minimize and zoom buttons in the middle of the page's header row (as far as the title bar allows).
  func placeWindowButtons() {
    let buttons = [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].compactMap { window.standardWindowButton($0) }
    guard let bar = buttons.first?.superview else { return }
    // the normal title bar: the buttons where AppKit puts them
    guard window.styleMask.contains(.fullSizeContentView) else { return }
    let middle = min(headerHeight * web.pageZoom / 2, bar.frame.height - 7)
    for (i, b) in buttons.enumerated() {
      b.setFrameOrigin(NSPoint(x: 14 + CGFloat(i) * 20, y: bar.frame.height - middle - b.frame.height / 2))
    }
  }

  /// Tells the page how much room its header leaves on the left for the window buttons, in page pixels (none in full screen).
  func tellPageInset() {
    guard sameOrigin(web.url) else { return }
    let px = window.styleMask.contains(.fullScreen) ? 14 : Int((headerInset / web.pageZoom).rounded())
    web.evaluateJavaScript("window.dashboard && window.dashboard.macInset && window.dashboard.macInset(\(px))", completionHandler: nil)
  }

  /// Takes the page's "drag" and "zoom" messages from its header, only from the main frame of the app's origin.
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, sameOrigin(message.frameInfo.request.url), let what = message.body as? String else { return }
    if what == "drag", let down = web.lastMouseDown { window.performDrag(with: down) }
    if what == "zoom" {
      // a double-click on the title bar does what System Settings → Desktop & Dock says
      switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
      case "Minimize": window.performMiniaturize(nil)
      case "None": break
      default: window.performZoom(nil)
      }
    }
  }

  // --- page zoom (⌘+, ⌘−, ⌘0); the zoom is kept across a quit

  func savedZoom() -> CGFloat {
    let z = UserDefaults.standard.double(forKey: "PageZoom")
    return z >= Double(zoomSteps.first!) && z <= Double(zoomSteps.last!) ? CGFloat(z) : 1
  }

  /// Sets the page zoom, keeps it, and moves the window buttons and the header room with it.
  func setZoom(_ z: CGFloat) {
    web.pageZoom = z
    UserDefaults.standard.set(Double(z), forKey: "PageZoom")
    placeWindowButtons()
    tellPageInset()
  }

  @objc func zoomIn(_ sender: Any?) { setZoom(nextZoom(web.pageZoom, 1)) }
  @objc func zoomOut(_ sender: Any?) { setZoom(nextZoom(web.pageZoom, -1)) }
  @objc func actualSize(_ sender: Any?) { setZoom(1) }

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
    item(view, NSMenuItem(title: "Actual Size", action: #selector(actualSize(_:)), keyEquivalent: "0"))
    item(view, NSMenuItem(title: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "+"))
    // ⌘= is ⌘+ without Shift, as in Safari: a hidden item with the same action
    let zoomInEq = NSMenuItem(title: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "=")
    zoomInEq.isHidden = true
    zoomInEq.allowsKeyEquivalentWhenHidden = true
    item(view, zoomInEq)
    item(view, NSMenuItem(title: "Zoom Out", action: #selector(zoomOut(_:)), keyEquivalent: "-"))
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
    headerTitleBar(false)
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
      web.evaluateJavaScript("!!(window.dashboard && window.dashboard.macInset)") { [weak self] r, _ in
        self?.headerTitleBar(r as? Bool == true)
        self?.tellPageInset()
      }
    } else {
      headerTitleBar(false)
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
