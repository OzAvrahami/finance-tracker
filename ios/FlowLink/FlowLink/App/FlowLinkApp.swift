import SwiftUI

@main struct FlowLinkApp: App {
  @Environment(\.scenePhase) private var scenePhase
  @State private var model: ConnectionModel?
  @State private var setupError: String?
  var body: some Scene {
    WindowGroup {
      Group {
        if let model {
          ConnectionView(model: model)
        } else if let setupError {
          ContentUnavailableView(
            "Connection unavailable", systemImage: "lock.shield", description: Text(setupError))
        } else {
          ProgressView("Opening FlowLink…")
        }
      }.onChange(of: scenePhase) { _, phase in
        if phase == .active {
          ForegroundCaptures.beginSession()
          Task { await ForegroundCaptures.resume() }
        }
      }.task {
        guard model == nil, setupError == nil else { return }
        do {
          let configuration = try FlowLinkConfiguration.installed()
          let metadata = try InstallationStore(configuration: configuration)
          let vault = KeychainCredentialStore(namespace: metadata.namespace)
          let api = FlowLinkAPIClient(configuration: configuration)
          let pairing = PairingService(
            api: api, vault: vault, metadata: metadata, configuration: configuration)
          model = ConnectionModel(api: api, pairing: pairing, configuration: configuration)
          await ForegroundCaptures.resume()
        } catch {
          setupError = (error as? FlowLinkError ?? .storageUnavailable).localizedDescription
        }
      }
    }
  }
}
