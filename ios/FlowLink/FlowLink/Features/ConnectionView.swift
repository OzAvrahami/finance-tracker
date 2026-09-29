import SwiftUI

struct ConnectionView: View {
  @Bindable var model: ConnectionModel
  @State private var pairingText = ""
  @State private var showScanner = false
  @State private var showManualPairing = false
  @FocusState private var pairingFocused: Bool
  var body: some View {
    NavigationStack {
      List {
        Section {
          Label {
            Text(model.state.title).font(.headline)
          } icon: {
            Image(systemName: model.state == .paired ? "checkmark.shield.fill" : "link")
              .foregroundStyle(model.state == .paired ? .green : .secondary)
          }
          .accessibilityIdentifier("connectionState")
          if let session = model.session {
            LabeledContent("Device", value: session.label)
            LabeledContent("Credential revision", value: session.credentialRevision)
          }
          if let message = model.message, model.session != nil || model.hasDraft {
            Text(message).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier(
              "safeMessage")
          }
          if model.busy { ProgressView("Connecting securely…") }
        } header: {
          Text("Connection")
        } footer: {
          Text(
            "A private connection to Finance Tracker. Connect once; no pairing code is needed for everyday use."
          )
        }
        if model.hasDraft {
          Section("Pairing recovery") {
            Text("A saved pairing can be retried without creating another device credential.")
            Button("Retry pairing") { Task { await model.retryPairing() } }
              .disabled(model.busy).accessibilityIdentifier("retryPairing")
            Button("Reset saved pairing", role: .destructive) { model.requestReset() }.disabled(
              model.busy)
          }
        } else if model.session == nil {
          Section("Connect this iPhone") {
            Text("On Finance Tracker, open Settings → FlowLink → Connect new iPhone.")
            Button("Scan QR", systemImage: "qrcode.viewfinder") { showScanner = true }
              .disabled(model.busy).accessibilityIdentifier("scanQR")
            DisclosureGroup("Having trouble scanning?", isExpanded: $showManualPairing) {
              Text("Reveal the code below the QR in Finance Tracker, then paste it here.")
              SecureField("Pairing code", text: $pairingText)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .accessibilityIdentifier("pairingCode")
                .focused($pairingFocused)
              Button("Connect") {
                pairingFocused = false
                let code = pairingText
                pairingText = ""
                Task { await model.connect(code: code) }
              }.disabled(model.busy || pairingText.isEmpty).accessibilityIdentifier("connect")
            }
            if let message = model.message {
              Text(message).font(.callout).foregroundStyle(.secondary)
                .accessibilityIdentifier("safeMessage")
            }
          }
        }
        if model.session != nil {
          Section {
            if model.cardsAreCached || model.state != .paired {
              Text("Saved cards — availability not verified. Refresh to check the connection.").foregroundStyle(
                .secondary)
                .accessibilityIdentifier("cachedBindingsNotice")
            }
            if model.cards.isEmpty && model.state == .paired {
              ContentUnavailableView(
                "No approved cards", systemImage: "creditcard",
                description: Text(
                  "The owner approves card bindings in Finance Tracker → Settings → FlowLink.")
              )
              .accessibilityIdentifier("emptyBindings")
            } else {
              ForEach(model.cards) { card in
                VStack(alignment: .leading, spacing: 6) {
                  Text(card.label).font(.headline)
                  Label(
                    model.cardsAreCached ? "Saved — availability not verified" : card.isAvailable
                      ? "Available" : card.status == .disabled ? "Disabled" : "Unavailable",
                    systemImage: !model.cardsAreCached && card.isAvailable ? "checkmark.circle" : "minus.circle"
                  )
                  .foregroundStyle(!model.cardsAreCached && card.isAvailable ? .green : .secondary)
                  Text("Revision \(card.revision)").font(.caption)
                    .foregroundStyle(.secondary)
                }.accessibilityElement(children: .combine)
              }
            }
            if let url = URL(string: FlowLinkConfiguration.ownerSite) {
              Link("Manage cards in Finance Tracker", destination: url)
                .accessibilityHint(
                  "Opens the owner web Settings page. No owner credentials are stored in FlowLink.")
            }
          } header: {
            Text("Cards")
          }
        }
        if model.state == .paired && model.cards.contains(where: \.isAvailable) {
          Section("Finish Wallet setup") {
            Text(
              "In Shortcuts, create a Wallet personal automation for your selected card. Add FlowLink → Record Wallet Transaction."
            )
            Text(
              "Choose the matching approved card binding. Set Amount to Transaction.Amount, Merchant to Transaction.Merchant, and Name to Transaction.Name."
            )
            Text(
              "Turn Show When Run off and keep the automation on. No Card or Pass or extra actions are needed."
            )
            Text("You set up this personal automation yourself; FlowLink cannot create it for you.")
              .font(.caption).foregroundStyle(.secondary)
          }
        }
        Section("Wallet captures") {
          NavigationLink("Capture receipts") { CaptureHistoryView() }
          Text(
            "Do not uninstall or forget this connection while captures are unresolved. Review receipts first; local removal cannot cancel server transactions."
          ).font(.caption).foregroundStyle(.secondary)
        }
        Section("Diagnostics") {
          NavigationLink("Capture diagnostics") { CaptureDiagnosticsView() }
          Button("Refresh") { Task { await model.restore() } }.disabled(model.busy)
          Button("Test Connection") { Task { await model.refresh() } }.disabled(
            model.busy || model.session == nil || model.hasDraft)
          if let status = model.status {
            LabeledContent("Protocol", value: String(status.protocolVersion))
            LabeledContent(
              "Ingestion",
              value: status.ingestionEnabled ? "Enabled on backend" : "Disabled on backend")
          } else {
            Text("Backend status not yet verified").foregroundStyle(.secondary)
          }
          LabeledContent("FlowLink", value: "0.1.0 (1)")
          DisclosureGroup("Connection details") {
            Text(model.backend).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
          }
          if model.session != nil {
            Button("Forget local connection", role: .destructive) { model.requestReset() }.disabled(
              model.busy)
          }
        }
      }
      .navigationTitle("FlowLink")
      .task { await model.restore() }
      .onDisappear { pairingText = "" }
      .sheet(isPresented: $showScanner) {
        PairingScannerView(
          connect: { code in Task { await model.connect(code: code) } },
          paste: { showManualPairing = true })
      }
      .alert(
        "Forget local connection?",
        isPresented: Binding(
          get: { model.needsResetConfirmation }, set: { if !$0 { model.cancelReset() } })
      ) {
        Button("Cancel", role: .cancel) { model.cancelReset() }
        Button("Forget", role: .destructive) { model.confirmReset() }
      } message: {
        Text(
          "Review unresolved capture receipts before continuing. This clears this installation’s credential and saved pairing, making its receipts unavailable until the same device identity is restored. It does not revoke the device on the server. Ask the owner to review any uncertain pairing before starting again."
        )
      }
    }
  }
}
