import {
  createSchemaMaps,
  deserializeMessage,
  serializedMessageSize,
  serializeMessage,
} from "./serde"
import { parse } from "./parse"

// CBuf layout for a non-naked struct:
//   uint32 CBUF_MAGIC (4 bytes)
//   uint32 sizeAndVariant (4 bytes)
//   uint64 hashValue (8 bytes)
//   float64 timestamp (8 bytes)
//   byte[] message
const CBUF_MAGIC = [0x54, 0x4e, 0x44, 0x56] // 'TNDV'
const CBUF_PREAMBLE_SIZE = 24

describe("serde", () => {
  const [nameToSchema1, hashToSchema1] = createSchemaMaps(parse("struct a { string b; bool c; }"))
  const hashValue1 = nameToSchema1.get("a")!.hashValue

  describe("createSchemaMaps", () => {
    it("should create valid schema maps", () => {
      expect(nameToSchema1.size).toEqual(1)
      expect(hashToSchema1.size).toEqual(1)
    })
  })

  describe("serializedMessageSize", () => {
    it("should calculate the size of a simple message", () => {
      const size1 = serializedMessageSize(nameToSchema1, {
        typeName: "a",
        timestamp: 0,
        message: {},
      })
      expect(size1).toEqual(CBUF_PREAMBLE_SIZE + 5)

      const size2 = serializedMessageSize(nameToSchema1, {
        typeName: "a",
        timestamp: 1,
        message: {
          b: "Hello, world!",
          c: false,
        },
      })
      expect(size2).toEqual(CBUF_PREAMBLE_SIZE + 18)
    })
  })

  describe("serializeMessage", () => {
    it("should serialize a simple message", () => {
      const cbuf = {
        typeName: "a",
        timestamp: 1,
        message: {
          b: "Hello, world!",
          c: true,
        },
      }
      const size = serializedMessageSize(nameToSchema1, cbuf)
      expect(size).toEqual(CBUF_PREAMBLE_SIZE + 18)

      const result = serializeMessage(nameToSchema1, cbuf)
      expect(new Uint8Array(result, 0, 4)).toEqual(new Uint8Array(CBUF_MAGIC))

      const view = new DataView(result)
      const sizeAndVariant = view.getUint32(4, true)
      const hasVariant = (sizeAndVariant & 0x8000000) >>> 0 == 0x8000000
      const extractedSize = hasVariant ? sizeAndVariant & 0x07ffffff : sizeAndVariant & 0x7fffffff
      const variant = hasVariant ? (sizeAndVariant >> 27) & 0x0f : 0
      expect(hasVariant).toEqual(false)
      expect(variant).toEqual(0)
      expect(extractedSize).toEqual(size)

      expect(view.getBigUint64(8, true)).toEqual(hashValue1)
      expect(view.getFloat64(16, true)).toEqual(1)
      expect(view.getUint32(24, true)).toEqual(13)
      expect(new TextDecoder().decode(result.slice(28, 28 + 13))).toEqual("Hello, world!")
      expect(view.getUint8(41)).toEqual(1)
    })
  })

  describe("deserializeMessage", () => {
    it("should deserialize a simple message", () => {
      const cbuf = {
        typeName: "a",
        size: 42,
        variant: 9,
        hashValue: hashValue1,
        timestamp: 3,
        message: {
          b: "Hello, world!",
          c: true,
        },
      }
      const serialized = serializeMessage(nameToSchema1, cbuf)
      // Ensure variant parsing works by modifying the size field to include a variant
      new DataView(serialized).setUint32(4, (9 << 27) | 42, true)
      const deserialized = deserializeMessage(
        nameToSchema1,
        hashToSchema1,
        new Uint8Array(serialized),
      )
      expect(deserialized).toEqual(cbuf)
    })
  })
})
