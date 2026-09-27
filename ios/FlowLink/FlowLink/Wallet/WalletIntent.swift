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
  let load: @MainActor @Sendable () async throws -> [CardBinding]
  init() { load = { try await WalletRuntime().bindings() } }
  init(load: @escaping @MainActor @Sendable () async throws -> [CardBinding]) { self.load = load }

  @MainActor func entities(for identifiers: [String]) async throws -> [FlowLinkCardBinding] {
    try await approved().filter { identifiers.contains($0.id) }
  }
  @MainActor func suggestedEntities() async throws -> [FlowLinkCardBinding] { try await approved() }
  @MainActor private func approved() async throws -> [FlowLinkCardBinding] {
    do {
      return try await load().filter(\.isAvailable).map {
        FlowLinkCardBinding(id: $0.id, label: $0.label)
      }
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
  @Parameter(title: "Amount", currencyCodes: ["ILS"]) var amount: IntentCurrencyAmount
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
    let message: String
    do {
      message = try await WalletRuntime().record(
        binding: card.id, amount: amount.amount, currency: amount.currencyCode,
        merchant: merchant, name: name, now: date, zone: zone, id: key)
    } catch {
      message =
        (error as? CaptureError)?.localizedDescription
        ?? "Could not send safely. Open FlowLink to review."
    }
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
