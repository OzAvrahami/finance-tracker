import AVFoundation
import SwiftUI

// The same parser used by manual pairing is the only accepted QR format.
@MainActor @Observable final class PairingScanGate {
  enum State: Equatable { case scanning, accepted, denied, unavailable, stopped }
  private(set) var state: State = .scanning
  private(set) var message: String?
  func accept(_ text: String) -> String? {
    guard state == .scanning else { return nil }
    guard (try? PairingCode(text)) != nil else {
      message = "This is not a Finance Tracker pairing QR. Scan the QR in Settings → FlowLink."
      return nil
    }
    state = .accepted
    message = nil
    return text
  }
  func cameraFailed(denied: Bool) {
    guard state == .scanning else { return }
    state = denied ? .denied : .unavailable
    message =
      denied
      ? "Camera access is off. Allow it in iPhone Settings, or paste the pairing code."
      : "The camera is unavailable. You can paste the pairing code instead."
  }
  func stop() { state = .stopped }
}

// Session configuration/start/stop and metadata callbacks are confined to queue.
// Only the preview layer references the session on the main thread, as required by UIKit.
private final class PairingCamera: NSObject, AVCaptureMetadataOutputObjectsDelegate,
  @unchecked Sendable
{
  let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "FlowLink.pairing-camera")
  private var stopped = false
  private let scanned: @MainActor @Sendable (String) -> Void
  private let failed: @MainActor @Sendable () -> Void
  init(
    scanned: @escaping @MainActor @Sendable (String) -> Void,
    failed: @escaping @MainActor @Sendable () -> Void
  ) {
    self.scanned = scanned
    self.failed = failed
  }
  func start() {
    queue.async { [self] in
      guard !stopped else { return }
      guard let device = AVCaptureDevice.default(for: .video),
        let input = try? AVCaptureDeviceInput(device: device)
      else {
        reportFailure()
        return
      }
      session.beginConfiguration()
      let output = AVCaptureMetadataOutput()
      guard session.canAddInput(input), session.canAddOutput(output) else {
        session.commitConfiguration()
        reportFailure()
        return
      }
      session.addInput(input)
      session.addOutput(output)
      guard output.availableMetadataObjectTypes.contains(.qr) else {
        session.commitConfiguration()
        reportFailure()
        return
      }
      output.setMetadataObjectsDelegate(self, queue: queue)
      output.metadataObjectTypes = [.qr]
      session.commitConfiguration()
      session.startRunning()
      if !session.isRunning { reportFailure() }
    }
  }
  func stop() {
    queue.async { [self] in
      stopped = true
      if session.isRunning { session.stopRunning() }
    }
  }
  private func reportFailure() { Task { @MainActor [failed] in failed() } }
  func metadataOutput(
    _ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard !stopped else { return }
    for case let object as AVMetadataMachineReadableCodeObject in objects where object.type == .qr {
      if let text = object.stringValue {
        Task { @MainActor [scanned] in scanned(text) }
        return
      }
    }
  }
}

private final class PairingPreview: UIView {
  override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
}
private struct PairingCameraPreview: UIViewRepresentable {
  let camera: PairingCamera
  func makeUIView(context: Context) -> PairingPreview {
    let view = PairingPreview()
    if let preview = view.layer as? AVCaptureVideoPreviewLayer {
      preview.session = camera.session
      preview.videoGravity = .resizeAspectFill
    }
    view.isAccessibilityElement = true
    view.accessibilityLabel = "Pairing QR camera. Point at the QR in Finance Tracker Settings."
    return view
  }
  func updateUIView(_ uiView: PairingPreview, context: Context) {}
}

struct PairingScannerView: View {
  let connect: (String) -> Void
  let paste: () -> Void
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase
  @State private var gate = PairingScanGate()
  @State private var camera: PairingCamera?
  @State private var acceptedCode: String?
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 20) {
          if let code = acceptedCode {
            Image(systemName: "checkmark.shield").font(.largeTitle)
            Text("Connect this iPhone to Finance Tracker?").font(.headline)
            Button("Connect") {
              acceptedCode = nil
              gate.stop()
              camera?.stop()
              dismiss()
              connect(code)
            }.buttonStyle(.borderedProminent).accessibilityIdentifier("confirmScannedPairing")
          } else if let camera, gate.state == .scanning {
            PairingCameraPreview(camera: camera).frame(height: 280).clipShape(
              .rect(cornerRadius: 16))
            Text("Point the camera at the QR in Finance Tracker → Settings → FlowLink.")
          } else if gate.state == .scanning {
            ProgressView("Opening camera…")
          }
          if let message = gate.message { Text(message).accessibilityIdentifier("scannerMessage") }
          Button("Paste pairing code instead") {
            gate.stop()
            camera?.stop()
            dismiss()
            paste()
          }.accessibilityIdentifier("scannerPaste")
        }
        .padding().frame(maxWidth: .infinity)
      }
      .navigationTitle("Scan QR").navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      .task {
        let allowed: Bool
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: allowed = true
        case .notDetermined: allowed = await AVCaptureDevice.requestAccess(for: .video)
        default: allowed = false
        }
        guard !Task.isCancelled, gate.state == .scanning else { return }
        guard allowed else {
          gate.cameraFailed(denied: true)
          return
        }
        let capture = PairingCamera(
          scanned: { text in
            guard let code = gate.accept(text) else { return }
            camera?.stop()
            acceptedCode = code
          }, failed: { gate.cameraFailed(denied: false) })
        camera = capture
        capture.start()
      }
      .onDisappear {
        gate.stop()
        camera?.stop()
        camera = nil
        acceptedCode = nil
      }
      .onChange(of: scenePhase) { _, phase in
        if phase == .background {
          gate.stop()
          camera?.stop()
          dismiss()
        }
      }
    }
  }
}
