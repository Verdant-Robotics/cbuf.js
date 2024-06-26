import { parse } from "./parse"
import {
  createSchemaMaps,
  deserializeMessage,
  serializedMessageSize,
  serializeMessage,
} from "./serde"

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

  const [nameToSchema2, hashToSchema2] = createSchemaMaps(
    parse(`
namespace ns1 {
  struct nested @naked {
    string text;
  }

  struct complex {
    nested inner;
    string a;
    short_string b;
    bool c;
    s8 d;
    s16 e;
    s32 f;
    s64 g;
    u8 h;
    u16 i;
    u32 j;
    u64 k;
    f32 l;
    f64 m;
    string n[];
    short_string o[] = {"a", "b", "c"};
    bool p[];
    s8 q[];
    s16 r[];
    s32 s[];
    s64 t[] = {1, 2, 3};
    u8 u[];
    u16 v[];
    u32 w[];
    u64 x[];
    f32 y[];
    f64 z[];
  }
}

namespace ns2 {
  struct outer {
    bool a;
    ns1::complex b;
    int c = 42;
  }
}`),
  )
  // const hashValue2 = nameToSchema2.get("b")!.hashValue

  describe("createSchemaMaps", () => {
    it("should create valid schema maps", () => {
      expect(nameToSchema1.size).toEqual(1)
      expect(hashToSchema1.size).toEqual(1)

      expect(nameToSchema2.size).toEqual(3)
      expect(hashToSchema2.size).toEqual(3)
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

    it("should calculate the size of a complex message", () => {
      const size1 = serializedMessageSize(nameToSchema2, {
        typeName: "ns2::outer",
        timestamp: 0,
        message: {},
      })
      expect(size1).toEqual(CBUF_PREAMBLE_SIZE + 216)

      const size2 = serializedMessageSize(nameToSchema2, {
        typeName: "ns2::outer",
        timestamp: 1,
        message: {
          b: {
            inner: { text: "abc" },
            a: "abcdef",
            b: "abcdefghi",
            n: ["abcdefghijkl"],
            p: [true],
            q: [-1],
            r: [-1, -2],
            s: [-1, -2, -3],
            t: [1, 2, 3],
            u: [255],
            v: [65535, 65534],
            w: [4294967295, 4294967294],
            x: [18446744073709551615n, 18446744073709551614n, 18446744073709551613n],
            y: [1.0],
            z: [1.0, 2.0],
          },
        },
      })
      expect(size2).toEqual(CBUF_PREAMBLE_SIZE + 316)
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
      const result = serializeMessage(nameToSchema1, cbuf)
      const view = new DataView(result)
      expect(new Uint8Array(result, 0, 4)).toEqual(new Uint8Array(CBUF_MAGIC))
      expect(view.getUint32(4, true)).toEqual(CBUF_PREAMBLE_SIZE + 18)
      expect(view.getBigUint64(8, true)).toEqual(hashValue1)
      expect(view.getFloat64(16, true)).toEqual(1)
      expect(view.getUint32(24, true)).toEqual(13)
      expect(new TextDecoder().decode(result.slice(28, 28 + 13))).toEqual("Hello, world!")
      expect(view.getUint8(41)).toEqual(1)
    })

    it("should serialize a complex message", () => {
      const cbuf = {
        typeName: "ns2::outer",
        timestamp: 1,
        message: {
          a: true,
          b: {
            inner: { text: "abc" },
            a: "abcdef",
            b: "abcdefghi",
            c: true,
            d: -1,
            e: -2,
            f: -3,
            g: -4,
            h: 255,
            i: 65535,
            j: 4294967295,
            k: 18446744073709551615n,
            l: -10.0,
            m: -11.0,
            n: ["abcdefghijkl"],
            // o - default value ["a", "b", "c"]
            p: [true],
            q: [-1],
            r: [-1, -2],
            s: [-1, -2, -3],
            t: [1, 2, 3],
            u: new Uint8Array([255]),
            v: new Uint16Array([65535, 65534]),
            w: [4294967295, 4294967294],
            x: [18446744073709551615n, 18446744073709551614n, 18446744073709551613n],
            y: [1.0],
            z: [1.0, 2.0],
          },
        },
      }
      const result = serializeMessage(nameToSchema2, cbuf)
      const view = new DataView(result)
      expect(new Uint8Array(result, 0, 4)).toEqual(new Uint8Array(CBUF_MAGIC))
      expect(view.getUint32(4, true)).toEqual(CBUF_PREAMBLE_SIZE + 316)
      expect(view.getBigUint64(8, true)).toEqual(13988650668746412734n)
      expect(view.getFloat64(16, true)).toEqual(1)
      expect(view.getUint8(24)).toEqual(1)

      // CBUF_PREAMBLE repeats again for ns1::complex struct
      expect(new Uint8Array(result, 25, 4)).toEqual(new Uint8Array(CBUF_MAGIC))
      expect(view.getUint32(29, true)).toEqual(311)
      expect(view.getBigUint64(33, true)).toEqual(6483351660403987869n)
      expect(view.getFloat64(41, true)).toEqual(0)

      // ns1::nested is @naked, so no preamble. Next field is nested.text
      expect(view.getUint32(49, true)).toEqual(3)
      expect(new TextDecoder().decode(result.slice(53, 53 + 3))).toEqual("abc")
      expect(view.getUint32(56, true)).toEqual(6)
      expect(new TextDecoder().decode(result.slice(60, 60 + 6))).toEqual("abcdef")
      expect(new TextDecoder().decode(result.slice(66, 66 + 15))).toEqual("abcdefghi\0\0\0\0\0\0")
      expect(view.getUint8(81)).toEqual(1)
      expect(view.getInt8(82)).toEqual(-1)
      expect(view.getInt16(83, true)).toEqual(-2)
      expect(view.getInt32(85, true)).toEqual(-3)
      expect(view.getBigInt64(89, true)).toEqual(-4n)
      expect(view.getUint8(97)).toEqual(255)
      expect(view.getUint16(98, true)).toEqual(65535)
      expect(view.getUint32(100, true)).toEqual(4294967295)
      expect(view.getBigUint64(104, true)).toEqual(18446744073709551615n)
      expect(view.getFloat32(112, true)).toEqual(-10)
      expect(view.getFloat64(116, true)).toEqual(-11)
      expect(view.getUint32(124, true)).toEqual(1) // Array length (n)
      expect(view.getUint32(128, true)).toEqual(12) // String length (n)
      expect(new TextDecoder().decode(result.slice(132, 132 + 12))).toEqual("abcdefghijkl")
      expect(view.getUint32(144, true)).toEqual(3) // Array length (o)
      expect(new TextDecoder().decode(result.slice(148, 148 + 15))).toEqual(
        "a\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
      )
      expect(new TextDecoder().decode(result.slice(163, 163 + 15))).toEqual(
        "b\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
      )
      expect(new TextDecoder().decode(result.slice(178, 178 + 15))).toEqual(
        "c\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
      )
      expect(view.getUint32(193, true)).toEqual(1) // Array length (p)
      expect(view.getUint8(197)).toEqual(1)
      expect(view.getUint32(198, true)).toEqual(1) // Array length (q)
      expect(view.getInt8(202)).toEqual(-1)
      expect(view.getUint32(203, true)).toEqual(2) // Array length (r)
      expect(view.getInt16(207, true)).toEqual(-1)
      expect(view.getInt16(209, true)).toEqual(-2)
      expect(view.getUint32(211, true)).toEqual(3) // Array length (s)
      expect(view.getInt32(215, true)).toEqual(-1)
      expect(view.getInt32(219, true)).toEqual(-2)
      expect(view.getInt32(223, true)).toEqual(-3)
      expect(view.getUint32(227, true)).toEqual(3) // Array length (t)
      expect(view.getBigInt64(231, true)).toEqual(1n)
      expect(view.getBigInt64(239, true)).toEqual(2n)
      expect(view.getBigInt64(247, true)).toEqual(3n)
      expect(view.getUint32(255, true)).toEqual(1) // Array length (u)
      expect(view.getUint8(259)).toEqual(255)
      expect(view.getUint32(260, true)).toEqual(2) // Array length (v)
      expect(view.getUint16(264, true)).toEqual(65535)
      expect(view.getUint16(266, true)).toEqual(65534)
      expect(view.getUint32(268, true)).toEqual(2) // Array length (w)
      expect(view.getUint32(272, true)).toEqual(4294967295)
      expect(view.getUint32(276, true)).toEqual(4294967294)
      expect(view.getUint32(280, true)).toEqual(3) // Array length (x)
      expect(view.getBigUint64(284, true)).toEqual(18446744073709551615n)
      expect(view.getBigUint64(292, true)).toEqual(18446744073709551614n)
      expect(view.getBigUint64(300, true)).toEqual(18446744073709551613n)
      expect(view.getUint32(308, true)).toEqual(1) // Array length (y)
      expect(view.getFloat32(312, true)).toEqual(1)
      expect(view.getUint32(316, true)).toEqual(2) // Array length (z)
      expect(view.getFloat64(320, true)).toEqual(1)
      expect(view.getFloat64(328, true)).toEqual(2)
      expect(view.getInt32(336, true)).toEqual(42) // Default value for c
    })
  })

  describe("deserializeMessage", () => {
    it("should round-trip a simple message", () => {
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

    it("should round-trip a complex message", () => {
      const cbuf = {
        typeName: "ns2::outer",
        size: 315,
        variant: 9,
        hashValue: 13988650668746412734n,
        timestamp: 3,
        message: {
          a: true,
          b: {
            inner: { text: "a" },
            a: "bc",
            b: "def",
            c: true,
            d: -1,
            e: -2,
            f: -3,
            g: -4n,
            h: 5,
            i: 6,
            j: 7,
            k: 8n,
            l: 9.5,
            m: 10.5,
            n: ["ghij"],
            o: ["a", "b", "c"],
            p: [false, true],
            q: new Int8Array([-11]),
            r: new Int16Array([-12, -13]),
            s: new Int32Array([-14, -15, -16]),
            t: new BigInt64Array([17n, 18n]),
            u: new Uint8Array([19]),
            v: new Uint16Array([20, 21]),
            w: new Uint32Array([22, 23, 24]),
            x: new BigUint64Array([25n, 26n]),
            y: new Float32Array([27.5]),
            z: new Float64Array([28.5, 29.5]),
          },
          c: 42,
        },
      }
      const serialized = serializeMessage(nameToSchema2, cbuf)
      // Ensure variant parsing works by modifying the size field to include a variant
      new DataView(serialized).setUint32(4, (9 << 27) | 315, true)
      const deserialized = deserializeMessage(
        nameToSchema2,
        hashToSchema2,
        new Uint8Array(serialized),
      )
      expect(deserialized).toEqual(cbuf)
    })
  })
})
