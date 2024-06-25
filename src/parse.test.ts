// parse.test.ts
// Description: Jest tests for the CBUF grammar

import { parse, preprocess } from "./parse"

describe("parse", () => {
  describe("basic structs", () => {
    it("should parse a simple message definition", () => {
      const result = parse("struct a { bool b; }")
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 3808120302725858088n,
          isEnum: false,
          definitions: [
            {
              type: "bool",
              name: "b",
            },
          ],
        },
      ])
    })

    it("should parse a message definition with multiple fields", () => {
      const result = parse("struct a { bool b; int32_t c; }")
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 4036783964384908627n,
          isEnum: false,
          definitions: [
            {
              type: "bool",
              name: "b",
            },
            {
              type: "int32",
              name: "c",
            },
          ],
        },
      ])
    })

    it("should preprocess and parse a message definition with a comment", () => {
      const preResult = preprocess("struct a { bool b; /* comment */ }", new Map())
      expect(preResult).toEqual("struct a { bool b;  }")
      const result = parse(preResult)
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 3808120302725858088n,
          isEnum: false,
          definitions: [
            {
              type: "bool",
              name: "b",
            },
          ],
        },
      ])
    })

    it("should parse a message definition with a comment and multiple fields", () => {
      const preResult = preprocess("struct a { bool b; /* comment */ s32 c; }", new Map())
      expect(preResult).toEqual("struct a { bool b;  s32 c; }")
      const result = parse(preResult)
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 4036783964384908627n,
          isEnum: false,
          definitions: [
            {
              type: "bool",
              name: "b",
            },
            {
              type: "int32",
              name: "c",
            },
          ],
        },
      ])
    })

    it("should parse a naked struct", () => {
      const result = parse("struct a @naked { bool b; }")
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 3808120302725858088n,
          isEnum: false,
          isNakedStruct: true,
          definitions: [
            {
              type: "bool",
              name: "b",
            },
          ],
        },
      ])
    })

    it("should parse array fields", () => {
      const result = parse("struct a { uint32 b[]; }")
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 16587707399711602108n,
          isEnum: false,
          definitions: [
            {
              type: "uint32",
              name: "b",
              isArray: true,
            },
          ],
        },
      ])
    })

    it("should throw an error for an ambiguous parse", () => {
      expect(() => parse("struct a { bool b; } struct a { int32 c; }")).toThrow(
        "Duplicate entity name: a",
      )
    })

    it("should throw an error for no parse results", () => {
      expect(() => parse("")).toThrow("No parse results")
    })
  })

  describe("default values", () => {
    it("should parse a message definition with default values", () => {
      const result = parse("struct a { bool b = true; }")
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 3808120302725858088n,
          isEnum: false,
          definitions: [
            {
              type: "bool",
              name: "b",
              defaultValue: true,
            },
          ],
        },
      ])
    })

    it("should parse a message definition with a default array value", () => {
      const result = parse("struct a { bool b[] = {true, false} ; }")
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 1509765891216373104n,
          isEnum: false,
          definitions: [
            {
              type: "bool",
              name: "b",
              isArray: true,
              defaultValue: [true, false],
            },
          ],
        },
      ])
    })

    it("should parse pose_msg", () => {
      const result = parse(
        "struct pose_msg { double xyz[3] = {0, 0, 0}; double rpy[3] = {-1, -2, -3}; }",
      )
      expect(result).toEqual([
        {
          name: "pose_msg",
          namespaces: [],
          hashValue: 8994656239654062125n,
          isEnum: false,
          definitions: [
            {
              type: "float64",
              name: "xyz",
              isArray: true,
              arrayLength: 3,
              defaultValue: [0, 0, 0],
            },
            {
              type: "float64",
              name: "rpy",
              isArray: true,
              arrayLength: 3,
              defaultValue: [-1, -2, -3],
            },
          ],
        },
      ])
    })
  })

  describe("enums", () => {
    it("should parse an enum", () => {
      const result = parse("enum a { b, c, d } struct e { a f = c; }")
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 0n,
          isEnum: true,
          isEnumClass: false,
          definitions: [
            {
              name: "b",
              isConstant: true,
              type: "uint32",
              value: 0,
            },
            {
              name: "c",
              isConstant: true,
              type: "uint32",
              value: 1,
            },
            {
              name: "d",
              isConstant: true,
              type: "uint32",
              value: 2,
            },
          ],
        },
        {
          name: "e",
          namespaces: [],
          hashValue: 14341441348656048252n,
          isEnum: false,
          definitions: [
            {
              type: "uint32",
              name: "f",
              defaultValue: 1,
            },
          ],
        },
      ])
    })

    it("should parse an enum class", () => {
      const result = parse("enum class a { b } struct c { bool d; }")
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 0n,
          isEnum: true,
          isEnumClass: true,
          definitions: [
            {
              name: "b",
              isConstant: true,
              type: "uint32",
              value: 0,
            },
          ],
        },
        {
          name: "c",
          namespaces: [],
          hashValue: 3909204515753383596n,
          isEnum: false,
          definitions: [
            {
              type: "bool",
              name: "d",
            },
          ],
        },
      ])
    })

    it("should parse an enum with explicit values", () => {
      const result = parse("enum a { b = 10, c = 20, d, e = 30, f } struct b { a b = d; }")
      expect(result).toEqual([
        {
          name: "a",
          namespaces: [],
          hashValue: 0n,
          isEnum: true,
          isEnumClass: false,
          definitions: [
            {
              name: "b",
              isConstant: true,
              type: "uint32",
              value: 10,
            },
            {
              name: "c",
              isConstant: true,
              type: "uint32",
              value: 20,
            },
            {
              name: "d",
              isConstant: true,
              type: "uint32",
              value: 21,
            },
            {
              name: "e",
              isConstant: true,
              type: "uint32",
              value: 30,
            },
            {
              name: "f",
              isConstant: true,
              type: "uint32",
              value: 31,
            },
          ],
        },
        {
          name: "b",
          namespaces: [],
          hashValue: 16366175273103426901n,
          isEnum: false,
          definitions: [
            {
              type: "uint32",
              name: "b",
              defaultValue: 21,
            },
          ],
        },
      ])
    })

    it("should error if no struct is defined", () => {
      expect(() => parse("enum a { b, c, d }")).toThrow("No struct definitions found")
    })
  })

  describe("constants", () => {
    it("should allow constant declarations", () => {
      const result = parse("const uint32 a = 123; struct b { uint32 a; }")
      expect(result).toEqual([
        {
          name: "b",
          namespaces: [],
          hashValue: 16366175273103390964n,
          isEnum: false,
          definitions: [
            {
              type: "uint32",
              name: "a",
            },
          ],
        },
      ])
    })

    it("should disallow constants in default values", () => {
      expect(() => parse("const uint32 a = 123; struct b { uint32 a = a; }")).toThrow(
        "Invalid default value",
      )
    })

    it("should throw an error for a constant with no value", () => {
      expect(() => parse("const uint32 a;")).toThrow("Syntax error at line 1")
    })

    it("should throw an error for a constant with an invalid value", () => {
      expect(() => parse("const uint32 a = foo; struct b { bool c; }")).toThrow(
        "Invalid default value",
      )
    })
  })

  describe("namespaces", () => {
    it("should fail on an empty namespace", () => {
      expect(() => parse("namespace a { /* comment */ }")).toThrow()
    })

    it("should parse a namespace with a struct", () => {
      const result = parse("namespace a { struct b { bool c; } }")
      expect(result).toEqual([
        {
          name: "a::b",
          namespaces: ["a"],
          hashValue: 12820973806649668735n,
          isEnum: false,
          definitions: [
            {
              type: "bool",
              name: "c",
            },
          ],
        },
      ])
    })

    it("should disallow nested namespaces", () => {
      expect(() => parse("namespace a { namespace b { struct c { bool d; } } }")).toThrow(
        "Nested namespaces are not allowed",
      )
    })

    it("should handle multiple namespaces", () => {
      const result = parse(`
namespace ns1 {
  enum a { b }
  struct c { a d; }
}

namespace ns2 {
  enum e { f }
  struct g { e h; ns2::e i; ns1::a j; ns1::c k; }
}`)
      expect(result).toEqual([
        {
          name: "ns1::a",
          namespaces: ["ns1"],
          hashValue: 0n,
          isEnum: true,
          isEnumClass: false,
          definitions: [
            {
              name: "b",
              isConstant: true,
              type: "uint32",
              value: 0,
            },
          ],
        },
        {
          name: "ns1::c",
          namespaces: ["ns1"],
          hashValue: 2299624816536008030n,
          isEnum: false,
          definitions: [
            {
              type: "uint32",
              name: "d",
            },
          ],
        },
        {
          name: "ns2::e",
          namespaces: ["ns2"],
          hashValue: 0n,
          isEnum: true,
          isEnumClass: false,
          definitions: [
            {
              name: "f",
              isConstant: true,
              type: "uint32",
              value: 0,
            },
          ],
        },
        {
          name: "ns2::g",
          namespaces: ["ns2"],
          hashValue: 3084739611297464190n,
          isEnum: false,
          definitions: [
            {
              type: "uint32",
              name: "h",
            },
            {
              type: "uint32",
              name: "i",
            },
            {
              type: "uint32",
              name: "j",
            },
            {
              type: "ns1::c",
              name: "k",
              isComplex: true,
            },
          ],
        },
      ])
    })
  })
})
