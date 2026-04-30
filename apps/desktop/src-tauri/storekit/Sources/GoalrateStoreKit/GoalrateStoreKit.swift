import Darwin
import Foundation
import StoreKit

#if os(macOS)
import AppKit
#endif

private let plusProductID = "com.goalrate.desktop.plus.monthly"
private let managementURL = "https://support.apple.com/guide/app-store/cancel-change-or-share-subscriptions-fire5f3a0745/mac"

private struct BridgeEnvelope<T: Encodable>: Encodable {
    let ok: Bool
    let data: T?
    let error: String?
}

private struct StoreKitProductPayload: Codable {
    let productId: String
    let displayName: String
    let description: String
    let displayPrice: String
    let subscriptionPeriod: SubscriptionPeriodPayload?
}

private struct SubscriptionPeriodPayload: Codable {
    let unit: String
    let value: Int
    let display: String
}

private struct StoreKitStatusPayload: Codable {
    let planId: String
    let state: String
    let active: Bool
    let willRenew: Bool?
    let productId: String?
    let expiresAt: String?
    let checkedAt: String
    let managementUrl: String
    let latestTransactionId: String?
    let originalTransactionId: String?
    let transactionJws: String?
}

private func jsonPointer<T: Encodable>(_ value: BridgeEnvelope<T>) -> UnsafeMutablePointer<CChar>? {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    guard
        let data = try? encoder.encode(value),
        let string = String(data: data, encoding: .utf8)
    else {
        return strdup("{\"ok\":false,\"data\":null,\"error\":\"Unable to encode StoreKit response.\"}")
    }
    return strdup(string)
}

private func errorPointer(_ message: String) -> UnsafeMutablePointer<CChar>? {
    jsonPointer(BridgeEnvelope<String>(ok: false, data: nil, error: message))
}

private func idsFromCString(_ pointer: UnsafePointer<CChar>?) -> [String] {
    guard let pointer else {
        return [plusProductID]
    }
    let raw = String(cString: pointer)
    if
        let data = raw.data(using: .utf8),
        let ids = try? JSONDecoder().decode([String].self, from: data),
        !ids.isEmpty
    {
        return ids
    }
    return [plusProductID]
}

private func iso8601(_ date: Date?) -> String? {
    guard let date else {
        return nil
    }
    return ISO8601DateFormatter().string(from: date)
}

private func waitForResult<T: Encodable>(
    timeoutSeconds: Double = 90,
    _ operation: @escaping () async -> BridgeEnvelope<T>
) -> UnsafeMutablePointer<CChar>? {
    let semaphore = DispatchSemaphore(value: 0)
    var envelope: BridgeEnvelope<T>?

    Task {
        envelope = await operation()
        semaphore.signal()
    }

    let result = semaphore.wait(timeout: .now() + timeoutSeconds)
    if result == .timedOut {
        return errorPointer("The App Store did not respond in time. Please try again.")
    }

    return jsonPointer(
        envelope ?? BridgeEnvelope<T>(
            ok: false,
            data: nil,
            error: "StoreKit returned no response."
        )
    )
}

@available(macOS 12.0, *)
private func verified<T>(_ result: VerificationResult<T>) throws -> T {
    switch result {
    case .verified(let value):
        return value
    case .unverified(_, let error):
        throw error
    }
}

@available(macOS 12.0, *)
private func periodPayload(_ period: Product.SubscriptionPeriod?) -> SubscriptionPeriodPayload? {
    guard let period else {
        return nil
    }

    let unit: String
    switch period.unit {
    case .day:
        unit = "day"
    case .week:
        unit = "week"
    case .month:
        unit = "month"
    case .year:
        unit = "year"
    @unknown default:
        unit = "unknown"
    }

    let noun = period.value == 1 ? unit : "\(unit)s"
    let display = period.value == 1
        ? unit.prefix(1).uppercased() + unit.dropFirst() + "ly"
        : "Every \(period.value) \(noun)"

    return SubscriptionPeriodPayload(
        unit: unit,
        value: period.value,
        display: String(display)
    )
}

@available(macOS 12.0, *)
private func productPayload(_ product: Product) -> StoreKitProductPayload {
    StoreKitProductPayload(
        productId: product.id,
        displayName: product.displayName,
        description: product.description,
        displayPrice: product.displayPrice,
        subscriptionPeriod: periodPayload(product.subscription?.subscriptionPeriod)
    )
}

@available(macOS 12.0, *)
private func renewalStateString(_ state: Product.SubscriptionInfo.RenewalState) -> String {
    if state == .subscribed {
        return "active"
    }
    if state == .inGracePeriod {
        return "gracePeriod"
    }
    if state == .inBillingRetryPeriod {
        return "billingRetry"
    }
    if state == .expired {
        return "expired"
    }
    if state == .revoked {
        return "revoked"
    }
    return "unavailable"
}

@available(macOS 12.0, *)
private func statusPayload(for productIDs: [String]) async throws -> StoreKitStatusPayload {
    let products = try await Product.products(for: productIDs)
    let checkedAt = ISO8601DateFormatter().string(from: Date())

    guard let product = products.first(where: { productIDs.contains($0.id) }) else {
        return StoreKitStatusPayload(
            planId: "free",
            state: "unavailable",
            active: false,
            willRenew: nil,
            productId: nil,
            expiresAt: nil,
            checkedAt: checkedAt,
            managementUrl: managementURL,
            latestTransactionId: nil,
            originalTransactionId: nil,
            transactionJws: nil
        )
    }

    guard let subscription = product.subscription else {
        return StoreKitStatusPayload(
            planId: "free",
            state: "unavailable",
            active: false,
            willRenew: nil,
            productId: product.id,
            expiresAt: nil,
            checkedAt: checkedAt,
            managementUrl: managementURL,
            latestTransactionId: nil,
            originalTransactionId: nil,
            transactionJws: nil
        )
    }

    let statuses = try await subscription.status
    guard !statuses.isEmpty else {
        return StoreKitStatusPayload(
            planId: "free",
            state: "none",
            active: false,
            willRenew: nil,
            productId: product.id,
            expiresAt: nil,
            checkedAt: checkedAt,
            managementUrl: managementURL,
            latestTransactionId: nil,
            originalTransactionId: nil,
            transactionJws: nil
        )
    }

    func rank(_ state: Product.SubscriptionInfo.RenewalState) -> Int {
        if state == .subscribed {
            return 50
        }
        if state == .inGracePeriod {
            return 40
        }
        if state == .inBillingRetryPeriod {
            return 30
        }
        if state == .expired {
            return 20
        }
        if state == .revoked {
            return 10
        }
        return 0
    }

    let bestStatus = statuses.max { left, right in
        rank(left.state) < rank(right.state)
    }!
    let transaction = try? verified(bestStatus.transaction)
    let renewalInfo = try? verified(bestStatus.renewalInfo)
    let rawState = renewalStateString(bestStatus.state)
    let isEntitled = rawState == "active" || rawState == "gracePeriod"
    let willRenew = renewalInfo?.willAutoRenew
    let state = isEntitled && willRenew == false ? "activeCanceled" : rawState

    return StoreKitStatusPayload(
        planId: isEntitled ? "plus" : "free",
        state: state,
        active: isEntitled,
        willRenew: willRenew,
        productId: transaction?.productID ?? product.id,
        expiresAt: iso8601(transaction?.expirationDate),
        checkedAt: checkedAt,
        managementUrl: managementURL,
        latestTransactionId: transaction.map { String($0.id) },
        originalTransactionId: transaction.map { String($0.originalID) },
        transactionJws: bestStatus.transaction.jwsRepresentation
    )
}

@available(macOS 12.0, *)
private func loadProduct(_ productIDs: [String]) async -> BridgeEnvelope<StoreKitProductPayload> {
    do {
        let products = try await Product.products(for: productIDs)
        guard let product = products.first(where: { productIDs.contains($0.id) }) else {
            return BridgeEnvelope(
                ok: false,
                data: nil,
                error: "GoalRate Plus is not configured in the App Store for this build."
            )
        }
        return BridgeEnvelope(ok: true, data: productPayload(product), error: nil)
    } catch {
        return BridgeEnvelope(ok: false, data: nil, error: error.localizedDescription)
    }
}

@available(macOS 12.0, *)
private func loadStatus(_ productIDs: [String]) async -> BridgeEnvelope<StoreKitStatusPayload> {
    do {
        return BridgeEnvelope(ok: true, data: try await statusPayload(for: productIDs), error: nil)
    } catch {
        return BridgeEnvelope(ok: false, data: nil, error: error.localizedDescription)
    }
}

@available(macOS 12.0, *)
private func purchasePlus(_ productIDs: [String]) async -> BridgeEnvelope<StoreKitStatusPayload> {
    do {
        let products = try await Product.products(for: productIDs)
        guard let product = products.first(where: { productIDs.contains($0.id) }) else {
            return BridgeEnvelope(
                ok: false,
                data: nil,
                error: "GoalRate Plus is not configured in the App Store for this build."
            )
        }

        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            let transaction = try verified(verification)
            await transaction.finish()
            return BridgeEnvelope(ok: true, data: try await statusPayload(for: productIDs), error: nil)
        case .userCancelled:
            return BridgeEnvelope(ok: true, data: try await statusPayload(for: productIDs), error: "Purchase canceled.")
        case .pending:
            return BridgeEnvelope(
                ok: true,
                data: StoreKitStatusPayload(
                    planId: "free",
                    state: "pending",
                    active: false,
                    willRenew: nil,
                    productId: product.id,
                    expiresAt: nil,
                    checkedAt: ISO8601DateFormatter().string(from: Date()),
                    managementUrl: managementURL,
                    latestTransactionId: nil,
                    originalTransactionId: nil,
                    transactionJws: nil
                ),
                error: nil
            )
        @unknown default:
            return BridgeEnvelope(ok: false, data: nil, error: "The App Store returned an unknown purchase result.")
        }
    } catch {
        return BridgeEnvelope(ok: false, data: nil, error: error.localizedDescription)
    }
}

@available(macOS 12.0, *)
private func restorePurchases(_ productIDs: [String]) async -> BridgeEnvelope<StoreKitStatusPayload> {
    do {
        try await AppStore.sync()
        return BridgeEnvelope(ok: true, data: try await statusPayload(for: productIDs), error: nil)
    } catch {
        return BridgeEnvelope(ok: false, data: nil, error: error.localizedDescription)
    }
}

@_cdecl("goalrate_storekit_get_product")
public func goalrateStoreKitGetProduct(_ productIDsJSON: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    if #available(macOS 12.0, *) {
        let productIDs = idsFromCString(productIDsJSON)
        return waitForResult {
            await loadProduct(productIDs)
        }
    }
    return errorPointer("StoreKit subscriptions require macOS 12 or later.")
}

@_cdecl("goalrate_storekit_get_status")
public func goalrateStoreKitGetStatus(_ productIDsJSON: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    if #available(macOS 12.0, *) {
        let productIDs = idsFromCString(productIDsJSON)
        return waitForResult {
            await loadStatus(productIDs)
        }
    }
    return errorPointer("StoreKit subscriptions require macOS 12 or later.")
}

@_cdecl("goalrate_storekit_purchase_plus")
public func goalrateStoreKitPurchasePlus(_ productIDsJSON: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    if #available(macOS 12.0, *) {
        let productIDs = idsFromCString(productIDsJSON)
        return waitForResult {
            await purchasePlus(productIDs)
        }
    }
    return errorPointer("StoreKit subscriptions require macOS 12 or later.")
}

@_cdecl("goalrate_storekit_restore_purchases")
public func goalrateStoreKitRestorePurchases(_ productIDsJSON: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    if #available(macOS 12.0, *) {
        let productIDs = idsFromCString(productIDsJSON)
        return waitForResult {
            await restorePurchases(productIDs)
        }
    }
    return errorPointer("StoreKit subscriptions require macOS 12 or later.")
}

@_cdecl("goalrate_storekit_open_management")
public func goalrateStoreKitOpenManagement() -> UnsafeMutablePointer<CChar>? {
    #if os(macOS)
    if let url = URL(string: managementURL) {
        NSWorkspace.shared.open(url)
        return jsonPointer(BridgeEnvelope<String>(ok: true, data: "opened", error: nil))
    }
    #endif
    return errorPointer("Unable to open App Store subscription management.")
}

@_cdecl("goalrate_storekit_free_string")
public func goalrateStoreKitFreeString(_ pointer: UnsafeMutablePointer<CChar>?) {
    if let pointer {
        free(pointer)
    }
}
