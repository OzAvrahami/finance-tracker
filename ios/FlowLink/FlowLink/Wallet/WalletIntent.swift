import AppIntents
import Foundation

struct FlowLinkCardBinding: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation { "FlowLink card" }
  static var defaultQuery: FlowLinkBindingQuery { FlowLinkBindingQuery() }
  let id: String
  let label: String
  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(label)", subtitle: "\(String(id.prefix(8)))")
  }
}
struct FlowLinkBindingQuery: EntityQuery {
  let local: @MainActor @Sendable () throws -> [CardBinding]
  let refresh: @MainActor @Sendable () async throws -> [CardBinding]
  init() {
    local = { try WalletRuntime().localBindings() }
    refresh = { try await WalletRuntime().bindings() }
  }
  init(local: @escaping @MainActor @Sendable () throws -> [CardBinding],
    refresh: @escaping @MainActor @Sendable () async throws -> [CardBinding]) {
    self.local = local
    self.refresh = refresh
  }

  @MainActor func entities(for identifiers: [String]) async throws -> [FlowLinkCardBinding] {
    do {
      guard identifiers.count <= 32, identifiers.allSatisfy(Validation.uuid) else {
        throw CaptureError.binding
      }
      let cards = try local()
      try cards.forEach { try $0.validate() }
      // Keep disabled/retired metadata resolvable: capture evidence first, then
      // the server rejects unauthorized delivery. Never substitute another ID.
      let result = try identifiers.map { id in
        guard let card = cards.first(where: { $0.id == id }) else { throw CaptureError.binding }
        return FlowLinkCardBinding(id: card.id, label: card.label)
      }
      CaptureDiagnostics.checkpoint(.entityResolvedLocal)
      return result
    } catch {
      CaptureDiagnostics.checkpoint(.entityResolutionFailed, code: .binding)
      throw CaptureError.binding
    }
  }
  @MainActor func suggestedEntities() async throws -> [FlowLinkCardBinding] {
    do {
      let cards = try await refresh()
      try cards.forEach { try $0.validate() }
      return cards.filter(\.isAvailable).map { FlowLinkCardBinding(id: $0.id, label: $0.label) }
    } catch { throw CaptureError.connection }
  }
}

struct RecordWalletTransaction: AppIntent {
  static var title: LocalizedStringResource { "Record Wallet Transaction" }
  static var description: IntentDescription {
    "Record a positive ILS Wallet purchase with an owner-approved FlowLink card. Configure one automation per card."
  }
  static var openAppWhenRun: Bool { false }
  @Parameter(title: "Card binding") var card: FlowLinkCardBinding
  @Parameter(title: "Merchant") var merchant: String?
  @Parameter(title: "Name") var name: String?
  @Parameter(title: "Amount") var amount: String
  static var parameterSummary: some ParameterSummary {
    Summary("Record \(\.$amount) with \(\.$card)") {
      \.$merchant
      \.$name
    }
  }
  @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
    // Freeze entry evidence once, before binding lookup or any network work.
    let date = Date()
    let zone = TimeZone.current
    let key = UUID()
    CaptureDiagnostics.checkpoint(.intentInvoked)
    let message: String
    do {
      message = try await WalletRuntime().record(
        binding: card.id, bindingLabel: card.label, amountText: amount,
        merchant: merchant, name: name, now: date, zone: zone, id: key)
    } catch {
      CaptureDiagnostics.checkpoint(.intentFailed, code: .from(error))
      message =
        (error as? CaptureError)?.localizedDescription
        ?? "Could not send safely. Open FlowLink to review."
    }
    CaptureDiagnostics.checkpoint(.intentCompleted)
    return .result(dialog: IntentDialog(stringLiteral: message))
  }
}
struct FlowLinkShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: RecordWalletTransaction(),
      phrases: ["Record a Wallet transaction with \(.applicationName)"],
      shortTitle: "Record Wallet Transaction", systemImageName: "creditcard")
  }
}
