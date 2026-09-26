import Foundation
import Observation

@MainActor @Observable final class ConnectionModel {
  private(set) var state: DeviceState = .unpaired
  private(set) var session: DeviceSession?
  private(set) var status: DeviceResponse?
  private(set) var cards: [CardBinding] = []
  private(set) var message: String?
  private(set) var hasDraft = false
  private(set) var busy = false
  private(set) var needsResetConfirmation = false
  let backend: String
  private let api: any FlowLinkAPI
  private let pairing: PairingService
  private let bindings: BindingService
  init(api: any FlowLinkAPI, pairing: PairingService, configuration: FlowLinkConfiguration) {
    self.api = api
    self.pairing = pairing
    bindings = BindingService(api: api)
    backend = configuration.baseURL.absoluteString
  }
  func restore() async {
    guard !busy else { return }
    do {
      hasDraft = try pairing.draft() != nil
      session = try pairing.current()?.session
      if hasDraft {
        state = .unpaired
        message = "An unfinished pairing is saved securely. Retry it before starting another."
        return
      }
      if session != nil { await refresh() } else { state = .unpaired }
    } catch { present(error) }
  }
  func connect(code: String) async {
    guard !busy else { return }
    do {
      try pairing.prepare(code)
      hasDraft = true
    } catch {
      present(error)
      return
    }
    await retryPairing()
  }
  func retryPairing() async {
    guard !busy else { return }
    busy = true
    state = .pairing
    message = nil
    do {
      session = try await pairing.resume()
      hasDraft = false
      state = .paired
    } catch { present(error) }
    busy = false
    if !hasDraft && session != nil { await refresh() }
  }
  func refresh() async {
    guard !busy else { return }
    busy = true
    message = nil
    defer { busy = false }
    do {
      guard let connection = try pairing.current() else {
        state = .unpaired
        session = nil
        status = nil
        cards = []
        return
      }
      let live = try await api.device(connection.credential)
      try pairing.refreshIdentity(live.session)
      let latestCards = try await bindings.list(using: connection.credential)
      session = live.session
      status = live
      cards = latestCards
      state = .paired
    } catch { present(error) }
  }
  func requestReset() { if !busy { needsResetConfirmation = true } }
  func cancelReset() { needsResetConfirmation = false }
  func confirmReset() {
    guard needsResetConfirmation, !busy else { return }
    do {
      try pairing.reset(confirmed: true)
      session = nil
      status = nil
      cards = []
      hasDraft = false
      state = .unpaired
      message = nil
    } catch { present(error) }
    needsResetConfirmation = false
  }
  private func present(_ error: Error) {
    let safe = error as? FlowLinkError ?? .storageUnavailable
    message = safe.localizedDescription
    status = nil
    cards = []  // Never offer stale availability as current authority.
    switch safe {
    case .unauthorized: state = .revoked
    case .credentialUnavailable, .storageUnavailable: state = .credentialUnavailable
    case .offline, .timeout: state = .offline
    case .invalidPairing, .pairingInvalid, .pairingUnavailable, .pairingConflict: state = .unpaired
    default: state = .configurationError
    }
  }
}
