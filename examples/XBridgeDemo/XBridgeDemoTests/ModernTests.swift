import Testing
@testable import XBridgeDemo

struct ModernTests {
    @Test("XBridge discovers Swift Testing tests")
    func xbridgeDiscoversModernTests() {
        #expect("XBridge".hasPrefix("X"))
    }
}
