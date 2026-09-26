import Foundation
import Security

@MainActor protocol CredentialStore {
  func read(_ slot: String) throws -> Data?
  func store(_ data: Data, slot: String) throws
  func delete(_ slot: String) throws
}
@MainActor final class KeychainCredentialStore: CredentialStore {
  private let namespace: String
  init(namespace: String) { self.namespace = namespace }
  private func query(_ slot: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "FlowLink.credentials.v1",
      kSecAttrAccount as String: namespace + ":" + slot,
      kSecAttrSynchronizable as String: false,
    ]
  }
  func read(_ slot: String) throws -> Data? {
    var q = query(slot)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &value)
    if status == errSecItemNotFound { return nil }
    try check(status)
    guard let data = value as? Data else { throw FlowLinkError.credentialUnavailable }
    return data
  }
  func store(_ data: Data, slot: String) throws {
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let updated = SecItemUpdate(query(slot) as CFDictionary, attributes as CFDictionary)
    if updated == errSecItemNotFound {
      try check(SecItemAdd(query(slot).merging(attributes) { _, new in new } as CFDictionary, nil))
    } else {
      try check(updated)
    }
  }
  func delete(_ slot: String) throws {
    let status = SecItemDelete(query(slot) as CFDictionary)
    if status != errSecItemNotFound { try check(status) }
  }
  private func check(_ status: OSStatus) throws {
    guard status == errSecSuccess else { throw FlowLinkError.credentialUnavailable }
  }
}
