// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "GoalrateStoreKit",
    platforms: [
        .macOS(.v10_15),
    ],
    products: [
        .library(
            name: "GoalrateStoreKit",
            type: .static,
            targets: ["GoalrateStoreKit"]
        ),
    ],
    targets: [
        .target(name: "GoalrateStoreKit"),
    ]
)
