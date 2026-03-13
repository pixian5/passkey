// swift-tools-version: 6.2
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "app_macos",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(
            name: "PassMac",
            targets: ["app_macos"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "app_macos",
            path: "Sources",
            exclude: [
                ".DS_Store",
            ],
            linkerSettings: [
                .linkedLibrary("sqlite3"),
            ]
        ),
    ]
)
