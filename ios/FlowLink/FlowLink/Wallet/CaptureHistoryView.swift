import SwiftUI

struct CaptureHistoryView: View {
  @Environment(\.scenePhase) private var phase
  @State private var receipts: [CaptureReceipt] = []
  @State private var message: String?
  @State private var busy = false
  @State private var confirmation: CaptureReceipt?
  @State private var archiveConfirmation: CaptureReceipt?

  var body: some View {
    List {
      Section {
        Text(
          "Receipts are delivery records, not your Finance Tracker transaction list. Two separate automation runs create separate captures. Configure only one automation per Wallet card."
        )
        .font(.callout).foregroundStyle(.secondary)
        if let message { Text(message) }
        Button("Refresh and retry due captures") { Task { await refresh(sendDue: true) } }.disabled(
          busy)
      }
      if receipts.isEmpty {
        ContentUnavailableView("No capture receipts", systemImage: "creditcard")
      }
      ForEach(receipts) { receipt in
        if let request = try? receipt.capture.request {
          Section {
            Text(request.merchant).font(.headline)
            LabeledContent("Amount", value: "ILS " + request.amount)
            LabeledContent("Capture date", value: request.transaction_date)
            LabeledContent(
              "Card binding",
              value: receipt.capture.bindingLabel ?? "Earlier receipt — label unavailable")
            Text(receipt.title)
            if receipt.state == .heldForOwnerReview {
              Text(
                "Ingestion is disabled. This request did not post to Finance Tracker. This receipt will not send automatically. Review it, then authorize ingestion before manually retrying this same capture."
              )
              .font(.caption)
            }
            if receipt.retryable {
              Button("Retry same capture…") { confirmation = receipt }.disabled(busy)
            }
            if receipt.canArchiveSyntheticTest {
              Button("Mark as local test — never send…") { archiveConfirmation = receipt }
                .disabled(busy)
            }
            if receipt.state == .needsReview || (receipt.state == .failed && receipt.outcome != "synthetic_test_archived") {
              Text(
                "Review in Finance Tracker. This app cannot resolve or cancel financial records."
              ).font(.caption)
            }
          }
        }
      }
    }
    .navigationTitle("Capture receipts")
    .alert("Permanently exclude this synthetic test?", isPresented: Binding(
      get: { archiveConfirmation != nil }, set: { if !$0 { archiveConfirmation = nil } })
    ) {
      Button("Cancel", role: .cancel) { archiveConfirmation = nil }
      Button("Mark local test", role: .destructive) {
        let id = archiveConfirmation?.id
        archiveConfirmation = nil
        if let id { Task { await archive(id) } }
      }
    } message: {
      Text("Only confirm for your temporary ILS 1.23 FLOWLINK TEST Shortcut. The original local evidence stays unchanged and will never send. This does not cancel a financial transaction.")
    }
    .task { await refresh(sendDue: true) }
    .onChange(of: phase) { _, value in
      if value == .active {

        Task { await refresh(sendDue: true) }
      }
    }
    .alert(
      "Retry the original capture?",
      isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } })
    ) {
      Button("Cancel", role: .cancel) { confirmation = nil }
      Button("Retry") {
        let id = confirmation?.id
        confirmation = nil
        if let id { Task { await retry(id) } }
      }
    } message: {
      Text(
        "Only continue after reviewing this receipt and authorizing server ingestion. If ingestion is still disabled, it stays held. This resends the exact original card, date, amount and key. It does not create a replacement capture or change the card."
      )
    }
  }
  @MainActor private func refresh(sendDue: Bool) async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    do {
      let runtime = try WalletRuntime()
      let store = try runtime.store()
      receipts = try store.list() // Show durable evidence before any due delivery waits.
      if sendDue { await ForegroundCaptures.resume() }
      receipts = try store.list()
      message = nil
    } catch {
      message =
        "Receipts unavailable. Unlock the phone and check the FlowLink connection. Delivery may be uncertain; keep the original receipt and do not recreate the capture."
    }
  }
  @MainActor private func retry(_ id: String) async {
    guard !busy else { return }
    busy = true
    var retryFailed = false
    do {
      let runtime = try WalletRuntime()
      try await runtime.service(runtime.store()).send(id, manual: true)
    } catch { retryFailed = true }
    busy = false
    await refresh(sendDue: false)
    if retryFailed {
      message =
        "Delivery may be uncertain. The original receipt is retained; do not recreate this capture."
    }
  }
  @MainActor private func archive(_ id: String) async {
    do {
      try WalletRuntime().store().archiveSyntheticTest(id)
      await refresh(sendDue: false)
    } catch { message = "Could not mark this test. The receipt has been retained unchanged." }
  }
}

struct CaptureDiagnosticsView: View {
  @State private var entries: [CaptureDiagnostic] = []
  @State private var unavailable = false
  var body: some View {
    List {
      Text("Recent local stages only; no merchant, amount, card, credential or request payload. Missing stages do not prove that iOS invoked the action.")
      if unavailable { Text("Diagnostics unavailable. Unlock the phone and retry.") }
      if entries.isEmpty && !unavailable { Text("No capture diagnostics yet") }
      ForEach(entries) { entry in
        VStack(alignment: .leading) {
          Text(entry.stage.rawValue)
          Text(entry.date, style: .time).font(.caption)
          if let code = entry.code { Text(code).font(.caption) }
        }
      }
    }.navigationTitle("Capture diagnostics")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Refresh diagnostics", systemImage: "arrow.clockwise") { load() }
        }
      }
      .task { load() }
  }
  @MainActor private func load() {
    do {
      entries = try CaptureDiagnostics(directory: BindingDirectory.walletDirectory()).list()
      unavailable = false
    } catch { unavailable = true }
  }
}
