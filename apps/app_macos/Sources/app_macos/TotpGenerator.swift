import CryptoKit
import Foundation

enum TotpGenerator {
    private static let base32Alphabet: [Character: UInt8] = {
        var table: [Character: UInt8] = [:]
        let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        for (index, ch) in letters.enumerated() {
            table[ch] = UInt8(index)
        }
        table["2"] = 26
        table["3"] = 27
        table["4"] = 28
        table["5"] = 29
        table["6"] = 30
        table["7"] = 31
        return table
    }()

    static func currentCode(
        secret: String,
        at date: Date = Date(),
        digits: Int = 6,
        period: Int = 30
    ) -> String? {
        guard digits > 0, period > 0 else { return nil }
        guard let keyData = decodeBase32(secret), !keyData.isEmpty else { return nil }

        let timeCounter = UInt64(date.timeIntervalSince1970) / UInt64(period)
        var counter = timeCounter.bigEndian
        let counterData = withUnsafeBytes(of: &counter) { Data($0) }

        let key = SymmetricKey(data: keyData)
        let digest = Data(HMAC<Insecure.SHA1>.authenticationCode(for: counterData, using: key))

        guard let last = digest.last else { return nil }
        let offset = Int(last & 0x0F)
        guard offset + 3 < digest.count else { return nil }

        let binaryCode = ((UInt32(digest[offset]) & 0x7F) << 24)
            | ((UInt32(digest[offset + 1]) & 0xFF) << 16)
            | ((UInt32(digest[offset + 2]) & 0xFF) << 8)
            | (UInt32(digest[offset + 3]) & 0xFF)

        let modulo = powerOfTen(digits)
        let code = binaryCode % modulo
        return String(format: "%0*u", digits, code)
    }

    static func remainingSeconds(at date: Date = Date(), period: Int = 30) -> Int {
        guard period > 0 else { return 0 }
        let elapsed = Int(date.timeIntervalSince1970) % period
        let remaining = period - elapsed
        return remaining == 0 ? period : remaining
    }

    private static func powerOfTen(_ exponent: Int) -> UInt32 {
        var value: UInt32 = 1
        for _ in 0..<exponent {
            value *= 10
        }
        return value
    }

    private static func decodeBase32(_ secret: String) -> Data? {
        let cleaned = secret
            .uppercased()
            .filter { !$0.isWhitespace && $0 != "-" && $0 != "=" }
        guard !cleaned.isEmpty else { return nil }

        var buffer: UInt32 = 0
        var bitsInBuffer = 0
        var output: [UInt8] = []
        output.reserveCapacity((cleaned.count * 5) / 8)

        for char in cleaned {
            guard let value = base32Alphabet[char] else { return nil }
            buffer = (buffer << 5) | UInt32(value)
            bitsInBuffer += 5

            while bitsInBuffer >= 8 {
                let shift = bitsInBuffer - 8
                let byte = UInt8((buffer >> UInt32(shift)) & 0xFF)
                output.append(byte)
                bitsInBuffer -= 8
                buffer &= (UInt32(1) << UInt32(bitsInBuffer)) - 1
            }
        }

        return Data(output)
    }
}
