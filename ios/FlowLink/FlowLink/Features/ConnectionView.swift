import SwiftUI

struct ConnectionView: View {
  @Bindable var model: ConnectionModel
  @State private var pairingText = ""
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
            "A private connection to Finance Tracker. Wallet parameter compatibility is awaiting on-device verification."
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
            Text("Ask the Finance Tracker owner for a pairing code, then paste it here.")
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
            if let message = model.message {
              Text(message).font(.callout).foregroundStyle(.secondary)
                .accessibilityIdentifier("safeMessage")
            }
          }
        }
        if model.session != nil {
          Section {
            if model.state != .paired {
              Text("Refresh the connection to check current card availability.").foregroundStyle(
                .secondary)
            } else if model.cards.isEmpty {
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
                    card.isAvailable
                      ? "Available" : card.status == .disabled ? "Disabled" : "Unavailable",
                    systemImage: card.isAvailable ? "checkmark.circle" : "minus.circle"
                  )
                  .foregroundStyle(card.isAvailable ? .green : .secondary)
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
        Section("Wallet captures") {
          NavigationLink("Capture receipts") { CaptureHistoryView() }
          Text(
            "Do not uninstall or forget this connection while captures are unresolved. Review receipts first; local removal cannot cancel server transactions."
          ).font(.caption).foregroundStyle(.secondary)
        }
        Section("Diagnostics") {
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
          Text(model.backend).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
          if model.session != nil {
            Button("Forget local connection", role: .destructive) { model.requestReset() }.disabled(
              model.busy)
          }
        }
      }
      .navigationTitle("FlowLink")
      .task { await model.restore() }
      .onDisappear { pairingText = "" }
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
