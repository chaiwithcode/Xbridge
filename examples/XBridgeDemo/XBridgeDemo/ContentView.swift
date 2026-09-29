import SwiftUI

struct ContentView: View {
    private let features = [
        Feature(title: "Build", detail: "Compile with xcodebuild", symbol: "hammer.fill", color: .blue),
        Feature(title: "Test", detail: "XCTest & Swift Testing", symbol: "checkmark.seal.fill", color: .green),
        Feature(title: "Run", detail: "Simulator or device", symbol: "play.circle.fill", color: .indigo),
        Feature(title: "Diagnose", detail: "Inline build issues", symbol: "waveform.path.ecg", color: .orange),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "point.3.connected.trianglepath.dotted")
                            .font(.system(size: 42, weight: .semibold))
                            .foregroundStyle(.blue.gradient)

                        Text("Xcode power.\nVS Code flow.")
                            .font(.system(size: 36, weight: .bold, design: .rounded))

                        Text("A tiny project built to demonstrate XBridge.")
                            .foregroundStyle(.secondary)
                    }

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 14) {
                        ForEach(features) { feature in
                            VStack(alignment: .leading, spacing: 10) {
                                Image(systemName: feature.symbol)
                                    .font(.title2)
                                    .foregroundStyle(feature.color)
                                Text(feature.title)
                                    .font(.headline)
                                Text(feature.detail)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, minHeight: 108, alignment: .leading)
                            .padding()
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
                        }
                    }

                    Label("Connected to XBridge", systemImage: "checkmark.circle.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.green)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(.green.opacity(0.1), in: Capsule())
                }
                .padding(24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("XBridge Demo")
        }
    }
}

private struct Feature: Identifiable {
    let title: String
    let detail: String
    let symbol: String
    let color: Color

    var id: String { title }
}

#Preview {
    ContentView()
}
