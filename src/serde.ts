import { MessageDefinitionField } from "@foxglove/message-definition"

import { lookupMsgdef } from "./lookup"
import { CbufMessage, CbufMessageData, CbufMessageDefinition, CbufTypedArray } from "./types"

type TypedArrayConstructor =
  | Uint8ArrayConstructor
  | Int8ArrayConstructor
  | Uint16ArrayConstructor
  | Int16ArrayConstructor
  | Uint32ArrayConstructor
  | Int32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor
  | BigInt64ArrayConstructor
  | BigUint64ArrayConstructor

// The `metadata.cbuf` definition is bootstrapped so other definitions can be
// read from metadata messages in a cbuf `.cb` file
const METADATA_DEFINITION: CbufMessageDefinition = {
  name: "cbufmsg::metadata",
  namespaces: ["cbufmsg"],
  hashValue: 0xbe6738d544ab72c6n,
  isEnum: false,
  isEnumClass: false,
  isNakedStruct: false,
  definitions: [
    { name: "msg_hash", type: "uint64" },
    { name: "msg_name", type: "string" },
    { name: "msg_meta", type: "string" },
  ],
}

const HEADER_SIZE = 4 + 4 + 8 + 8

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

/**
 * @typedef {import('@foxglove/message-definition').MessageDefinition} MessageDefinition
 * @typedef {import("@foxglove/message-definition").MessageDefinitionField} MessageDefinitionField
 * @typedef {MessageDefinition & { hashValue: bigint; line: number; column: number; naked: boolean }} CbufMessageDefinition
 */

/**
 * Takes a parsed schema (`CbufMessageDefinition[]`) and returns two maps:
 * `Map<string, CbufMessageDefinition>` mapping message names to message definitions, and
 * `Map<bigint, CbufMessageDefinition>` mapping hash values to message definitions
 * @param schemas The parsed schema
 * @returns {[Map<string, CbufMessageDefinition>, Map<bigint, CbufMessageDefinition]} A tuple of the
 *   message name map and hash map
 */
export function createSchemaMaps(
  schemas: CbufMessageDefinition[],
): [Map<string, CbufMessageDefinition>, Map<bigint, CbufMessageDefinition>] {
  const messageMap = new Map<string, CbufMessageDefinition>()
  const hashMap = new Map<bigint, CbufMessageDefinition>()
  for (const schema of schemas) {
    messageMap.set(schema.name, schema)
    if (!schema.isEnum) {
      hashMap.set(schema.hashValue, schema)
    }
  }
  return [messageMap, hashMap]
}

/**
 * Given hash maps from message names and hash values to `CbufMessageDefinition`s, a byte buffer,
 * and optional offset into the buffer, deserialize the buffer into a JavaScript object representing
 * a single non-naked struct message, which includes a message header and message data.
 *
 * @param nameToSchema A map of fully qualified message names to message definitions
 * @param hashToSchema A map of hash values to message definitions obtained from `createSchemaMaps()`
 * @param data The byte buffer to deserialize from
 * @param offset Optional byte offset into the buffer to deserialize from
 * @returns An object representing the deserialized message header fields and message data
 */
export function deserializeMessage(
  nameToSchema: Map<string, CbufMessageDefinition>,
  hashToSchema: Map<bigint, CbufMessageDefinition>,
  data: ArrayBufferView,
  offset?: number,
): CbufMessage {
  let curOffset = offset ?? 0
  if (curOffset < 0 || curOffset >= data.byteOffset + data.byteLength) {
    throw new Error(
      `Invalid offset ${curOffset} for buffer {byteOffset=${data.byteOffset}, byteLength=${data.byteLength}`,
    )
  }

  // CBuf layout for a non-naked struct:
  //   CBUF_MAGIC (4 bytes) 0x56444e54
  //   sizeAndVariant uint32_t (4 bytes)
  //   hashValue uint64_t (8 bytes)
  //   timestamp double (8 bytes)
  //   message data

  // Create a view into the buffer starting at offset and reset offset to zero
  const view = new DataView(data.buffer, data.byteOffset + curOffset, data.byteLength - curOffset)
  curOffset = 0
  if (view.byteLength < 24) {
    throw new Error(`Buffer too small to contain cbuf header: ${view.byteLength} bytes`)
  }

  // CBUF_MAGIC
  const magic = view.getUint32(curOffset, true)
  curOffset += 4
  if (magic !== 0x56444e54) {
    throw new Error(`Invalid cbuf magic 0x${magic.toString(16)}`)
  }

  // size and variant
  const sizeAndVariant = view.getUint32(curOffset, true)
  const hasVariant = (sizeAndVariant & 0x8000000) >>> 0 === 0x8000000
  const size = hasVariant ? sizeAndVariant & 0x07ffffff : sizeAndVariant & 0x7fffffff
  const variant = hasVariant ? (sizeAndVariant >> 27) & 0x0f : 0
  curOffset += 4
  if (size > view.byteLength) {
    throw new Error(`cbuf size ${size} exceeds buffer of length ${view.byteLength}`)
  }

  // hashValue
  const hashValue = view.getBigUint64(curOffset, true)
  curOffset += 8

  // timestamp
  const timestamp = view.getFloat64(curOffset, true)
  curOffset += 8

  // Look up the message definition by hash value in the schema hash map with a fallback check for
  // the built-in metadata definition
  const msgdef =
    hashValue === METADATA_DEFINITION.hashValue ? METADATA_DEFINITION : hashToSchema.get(hashValue)
  if (!msgdef) {
    throw new Error(
      `cbuf hash value ${hashValue} not found in the hash map with ${hashToSchema.size} entries`,
    )
  }

  // message data
  const message = {}
  curOffset += deserializeNakedMessage(nameToSchema, hashToSchema, msgdef, view, curOffset, message)
  if (curOffset !== size) {
    throw new Error(`cbuf size ${size} does not match decoded size ${curOffset}`)
  }

  return {
    typeName: msgdef.name,
    size,
    variant,
    hashValue,
    timestamp,
    message,
  }
}

/**
 * Deserialize a single naked struct message from a DataView into a JavaScript object.
 * @returns {number} The number of bytes consumed from the buffer
 */
function deserializeNakedMessage(
  schemaMap: Map<string, CbufMessageDefinition>,
  hashMap: Map<bigint, CbufMessageDefinition>,
  msgdef: CbufMessageDefinition,
  view: DataView,
  offset: number,
  output: Record<string, unknown>,
): number {
  let innerOffset = 0

  for (const field of msgdef.definitions) {
    if (field.isArray === true) {
      // Array field (fixed or variable length)
      let arrayLength = field.arrayLength
      if (arrayLength == undefined) {
        arrayLength = view.getUint32(offset + innerOffset, true)
        innerOffset += 4
      }

      // The byte offset into the underlying ArrayBuffer we are reading from, for constructing
      // typed arrays
      const bufferOffset = view.byteOffset + offset + innerOffset

      switch (field.type) {
        case "bool": {
          const array = []
          for (let i = 0; i < arrayLength; i++) {
            array.push(view.getUint8(offset + innerOffset) !== 0)
            innerOffset += 1
          }
          output[field.name] = array
          break
        }
        case "uint8":
          output[field.name] = typedArray(Uint8Array, view.buffer, bufferOffset, arrayLength)
          innerOffset += arrayLength
          break
        case "int8":
          output[field.name] = typedArray(Int8Array, view.buffer, bufferOffset, arrayLength)
          innerOffset += arrayLength
          break
        case "uint16":
          output[field.name] = typedArray(Uint16Array, view.buffer, bufferOffset, arrayLength)
          innerOffset += arrayLength * 2
          break
        case "int16":
          output[field.name] = typedArray(Int16Array, view.buffer, bufferOffset, arrayLength)
          innerOffset += arrayLength * 2
          break
        case "uint32":
          output[field.name] = typedArray(Uint32Array, view.buffer, bufferOffset, arrayLength)
          innerOffset += arrayLength * 4
          break
        case "int32":
          output[field.name] = typedArray(Int32Array, view.buffer, bufferOffset, arrayLength)
          innerOffset += arrayLength * 4
          break
        case "uint64":
          output[field.name] = typedArray(BigUint64Array, view.buffer, bufferOffset, arrayLength)
          innerOffset += arrayLength * 8
          break
        case "int64":
          output[field.name] = typedArray(BigInt64Array, view.buffer, bufferOffset, arrayLength)
          innerOffset += arrayLength * 8
          break
        case "float32":
          output[field.name] = typedArray(Float32Array, view.buffer, bufferOffset, arrayLength)
          innerOffset += arrayLength * 4
          break
        case "float64":
          output[field.name] = typedArray(Float64Array, view.buffer, bufferOffset, arrayLength)
          innerOffset += arrayLength * 8
          break
        default: {
          // string array or nested struct array. Read each element individually and push onto an
          // array
          const array = []
          const fieldOutput: Record<string, unknown> = {}
          for (let i = 0; i < arrayLength; i++) {
            const curOffset = offset + innerOffset
            innerOffset += readNonArrayField(
              schemaMap,
              hashMap,
              field,
              msgdef.namespaces,
              view,
              curOffset,
              fieldOutput,
            )
            array.push(fieldOutput[field.name])
          }
          output[field.name] = array
          break
        }
      }
    } else {
      innerOffset += readNonArrayField(
        schemaMap,
        hashMap,
        field,
        msgdef.namespaces,
        view,
        offset + innerOffset,
        output,
      )
    }
  }

  return innerOffset
}

function typedArray(
  TypedArrayConstructor: TypedArrayConstructor,
  buffer: ArrayBuffer,
  offset: number,
  length: number,
): CbufTypedArray {
  // new TypedArrayConstructor(...) will throw if you try to make a typed array on unaligned boundary
  // but for aligned access we can use a typed array and avoid any extra memory alloc/copy
  if (offset % TypedArrayConstructor.BYTES_PER_ELEMENT === 0) {
    return new TypedArrayConstructor(buffer, offset, length)
  }

  // Copy the data to align it
  // Using _set_ is slightly faster than slice on the array buffer according to benchmarks when written
  const size = TypedArrayConstructor.BYTES_PER_ELEMENT * length
  const copy = new Uint8Array(size)
  copy.set(new Uint8Array(buffer, offset, size))
  return new TypedArrayConstructor(copy.buffer, copy.byteOffset, length)
}

function readNonArrayField(
  schemaMap: Map<string, CbufMessageDefinition>,
  hashMap: Map<bigint, CbufMessageDefinition>,
  field: MessageDefinitionField,
  namespaces: string[],
  view: DataView,
  offset: number,
  output: Record<string, unknown>,
): number {
  let innerOffset = 0

  if (field.isComplex === true) {
    const nestedMsgdef = lookupMsgdef(schemaMap, namespaces, field.type)

    if (nestedMsgdef.isNakedStruct) {
      // Nested naked struct (no header). Just deserialize the nested message
      const nestedMessage = {}
      innerOffset += deserializeNakedMessage(
        schemaMap,
        hashMap,
        nestedMsgdef,
        view,
        offset + innerOffset,
        nestedMessage,
      )
      output[field.name] = nestedMessage
    } else {
      // Nested non-naked struct. This has a cbuf message header followed by the message data
      const nestedMessage = deserializeMessage(schemaMap, hashMap, view, offset + innerOffset)
      output[field.name] = nestedMessage.message
      innerOffset += nestedMessage.size
    }
  } else {
    // Simple non-array type
    innerOffset += readBasicType(view, offset, output, field)
  }

  return innerOffset
}

/**
 * Read a basic cbuf type from a DataView into an output message object.
 * @param view DataView to read from
 * @param offset Byte offset in the DataView to read from
 * @param message Output message object to write a new field to
 * @param field Message definition for the field
 * @returns The number of bytes consumed from the buffer
 */
function readBasicType(
  view: DataView,
  offset: number,
  message: Record<string, unknown>,
  field: MessageDefinitionField,
): number {
  switch (field.type) {
    case "bool":
      message[field.name] = view.getUint8(offset) !== 0
      return 1
    case "int8":
      message[field.name] = view.getInt8(offset)
      return 1
    case "uint8":
      message[field.name] = view.getUint8(offset)
      return 1
    case "int16":
      message[field.name] = view.getInt16(offset, true)
      return 2
    case "uint16":
      message[field.name] = view.getUint16(offset, true)
      return 2
    case "int32":
      message[field.name] = view.getInt32(offset, true)
      return 4
    case "uint32":
      message[field.name] = view.getUint32(offset, true)
      return 4
    case "int64":
      message[field.name] = view.getBigInt64(offset, true)
      return 8
    case "uint64":
      message[field.name] = view.getBigUint64(offset, true)
      return 8
    case "float32":
      message[field.name] = view.getFloat32(offset, true)
      return 4
    case "float64":
      message[field.name] = view.getFloat64(offset, true)
      return 8
    case "string": {
      let curOffset = 0
      let length = field.upperBound
      if (length == undefined) {
        length = view.getUint32(offset, true)
        curOffset += 4
      }
      const bytes = new Uint8Array(view.buffer, view.byteOffset + offset + curOffset, length)
      const str = textDecoder.decode(bytes)
      message[field.name] = str.split("\0").shift()
      return curOffset + length
    }
    default:
      throw new Error(`Unsupported type ${field.type}`)
  }
}

/**
 * Given a schema map and a `CbufMessageData` object, return the size of the serialized message in
 * bytes, including the CBUF header.
 *
 * @returns The size of the serialized message in bytes, including the CBUF header
 */
export function serializedMessageSize(
  nameToSchema: Map<string, CbufMessageDefinition>,
  message: CbufMessageData,
): number {
  if (typeof message.message !== "object") {
    throw new Error(`message must be an object`)
  }

  // Find the message definition by name
  const msgdef =
    message.typeName === METADATA_DEFINITION.name
      ? METADATA_DEFINITION
      : nameToSchema.get(message.typeName)
  if (!msgdef) {
    throw new Error(`Unknown message type "${message.typeName}"`)
  }

  return HEADER_SIZE + serializedNakedMessageSize(nameToSchema, msgdef, message.message)
}

/**
 * Given a schema map and hash map, and a plain JavaScript object representing the message payload,
 * return the size of the serialized message in bytes (not including the CBUF header since this is
 * assumed to be a naked message struct).
 *
 * @returns The size of the serialized message in bytes
 */
function serializedNakedMessageSize(
  nameToSchema: Map<string, CbufMessageDefinition>,
  msgdef: CbufMessageDefinition,
  message: Record<string, unknown>,
): number {
  let size = 0
  for (const field of msgdef.definitions) {
    const value = message[field.name] ?? field.defaultValue

    if (field.isArray === true) {
      // Array field (fixed or variable length)
      const arrayValue = isArray(value) ? value : []
      let arrayLength = field.arrayLength
      if (arrayLength == undefined) {
        arrayLength = arrayValue.length
        size += 4
      }

      switch (field.type) {
        case "bool":
        case "uint8":
        case "int8":
          size += arrayLength
          break
        case "uint16":
        case "int16":
          size += arrayLength * 2
          break
        case "uint32":
        case "int32":
        case "float32":
          size += arrayLength * 4
          break
        case "uint64":
        case "int64":
        case "float64":
          size += arrayLength * 8
          break
        case "string":
          if (field.upperBound == undefined) {
            // Variable length string array. Each element has a 4-byte length prefix
            size += arrayLength * 4
            for (const element of arrayValue) {
              size += typeof element === "string" ? element.length : 0
            }
          } else {
            // Fixed length string array
            size += arrayLength * field.upperBound
          }
          break
        default:
          // Nested struct array. Compute the size of each element individually
          if (arrayValue.length > 0) {
            const nestedMsgdef = lookupMsgdef(nameToSchema, msgdef.namespaces, field.type)
            for (const element of arrayValue) {
              const nestedElement = (
                element != undefined && typeof element === "object" ? element : {}
              ) as Record<string, unknown>
              size += serializedNakedMessageSize(nameToSchema, nestedMsgdef, nestedElement)
            }
          }
          break
      }
    } else {
      if (field.isComplex === true) {
        const nestedMsgdef = lookupMsgdef(nameToSchema, msgdef.namespaces, field.type)

        if (!nestedMsgdef.isNakedStruct) {
          size += HEADER_SIZE
        }

        // Check if `value` is an object
        const nestedValue = (
          value != undefined && typeof value === "object" ? value : {}
        ) as Record<string, unknown>

        size += serializedNakedMessageSize(nameToSchema, nestedMsgdef, nestedValue)
      } else {
        switch (field.type) {
          case "bool":
          case "uint8":
          case "int8":
            size += 1
            break
          case "uint16":
          case "int16":
            size += 2
            break
          case "uint32":
          case "int32":
          case "float32":
            size += 4
            break
          case "uint64":
          case "int64":
          case "float64":
            size += 8
            break
          case "string": {
            let length = field.upperBound
            if (length == undefined) {
              length = typeof value === "string" ? value.length : 0
              size += 4
            }
            size += length
            break
          }
          default:
            throw new Error(`Unsupported type ${field.type}`)
        }
      }
    }
  }

  return size
}

/**
 * Given a schema map and hash map, and a `CbufMessage` object, serialize the message into a byte
 * buffer.
 *
 * @param nameToSchema A map of fully qualified message names to message definitions
 * @param message The message to serialize
 * @returns A byte buffer containing the serialized message
 */
export function serializeMessage(
  nameToSchema: Map<string, CbufMessageDefinition>,
  message: CbufMessageData,
): ArrayBuffer {
  let curOffset = 0

  // Find the message definition by name
  const msgdef =
    message.typeName === METADATA_DEFINITION.name
      ? METADATA_DEFINITION
      : nameToSchema.get(message.typeName)
  if (!msgdef) {
    throw new Error(`Unknown message type "${message.typeName}"`)
  }

  // Determine the total message size
  const size = serializedMessageSize(nameToSchema, message)
  const buffer = new ArrayBuffer(size)
  const view = new DataView(buffer)

  // CBuf layout for a non-naked struct:
  //   CBUF_MAGIC (4 bytes) 0x56444e54
  //   size uint32_t (4 bytes)
  //   hashValue uint64_t (8 bytes)
  //   timestamp double (8 bytes)
  //   message data

  // CBUF_MAGIC
  view.setUint32(curOffset, 0x56444e54, true)
  curOffset += 4

  // size and variant (variant is always zero)
  view.setUint32(curOffset, size, true)
  curOffset += 4

  // hashValue
  view.setBigUint64(curOffset, msgdef.hashValue, true)
  curOffset += 8

  // timestamp
  view.setFloat64(curOffset, message.timestamp, true)
  curOffset += 8

  // message data
  curOffset += serializeNakedMessage(nameToSchema, msgdef, message.message, view, curOffset)

  return buffer
}

/**
 * Serialize a single naked struct message into the given DataView at the given offset.
 *
 * @param nameToSchema
 * @param msgdef The message definition for the message to serialize
 * @param message The message payload to serialize
 * @param view The DataView to write to
 * @param offset The byte offset into the DataView to write to
 * @returns The number of bytes written to the DataView
 */
function serializeNakedMessage(
  nameToSchema: Map<string, CbufMessageDefinition>,
  msgdef: CbufMessageDefinition,
  message: Record<string, unknown>,
  view: DataView,
  offset: number,
): number {
  let innerOffset = 0
  for (const field of msgdef.definitions) {
    const value = message[field.name] ?? field.defaultValue

    if (field.isArray === true) {
      // Array field (fixed or variable length)
      const arrayValue = isArray(value) ? value : []
      let arrayLength = field.arrayLength
      if (arrayLength == undefined) {
        arrayLength = arrayValue.length
        view.setUint32(offset + innerOffset, arrayLength, true)
        innerOffset += 4
      }

      for (let i = 0; i < arrayLength; i++) {
        innerOffset += serializeNonArrayField(
          nameToSchema,
          msgdef.namespaces,
          field,
          arrayValue[i],
          view,
          offset + innerOffset,
        )
      }
    } else {
      innerOffset += serializeNonArrayField(
        nameToSchema,
        msgdef.namespaces,
        field,
        value,
        view,
        offset + innerOffset,
      )
    }
  }

  return innerOffset
}

/**
 * Serialize a single non-array field into the given DataView at the given offset.
 */
function serializeNonArrayField(
  nameToSchema: Map<string, CbufMessageDefinition>,
  namespaces: string[],
  field: MessageDefinitionField,
  value: unknown,
  view: DataView,
  curOffset: number,
): number {
  let innerOffset = 0

  if (field.isComplex === true) {
    const nestedMsgdef = lookupMsgdef(nameToSchema, namespaces, field.type)

    if (!nestedMsgdef.isNakedStruct) {
      const nestedSize = serializedNakedMessageSize(
        nameToSchema,
        nestedMsgdef,
        value as Record<string, unknown>,
      )

      view.setUint32(curOffset + innerOffset, 0x56444e54, true)
      innerOffset += 4
      view.setUint32(curOffset + innerOffset, HEADER_SIZE + nestedSize, true)
      innerOffset += 4
      view.setBigUint64(curOffset + innerOffset, nestedMsgdef.hashValue, true)
      innerOffset += 8
      view.setFloat64(curOffset + innerOffset, 0.0, true)
      innerOffset += 8
    }

    innerOffset += serializeNakedMessage(
      nameToSchema,
      nestedMsgdef,
      value as Record<string, unknown>,
      view,
      curOffset + innerOffset,
    )
  } else {
    switch (field.type) {
      case "bool":
      case "uint8":
        view.setUint8(curOffset + innerOffset, getNumber(value))
        innerOffset += 1
        break
      case "int8":
        view.setInt8(curOffset + innerOffset, getNumber(value))
        innerOffset += 1
        break
      case "uint16":
        view.setUint16(curOffset + innerOffset, getNumber(value), true)
        innerOffset += 2
        break
      case "int16":
        view.setInt16(curOffset + innerOffset, getNumber(value), true)
        innerOffset += 2
        break
      case "uint32":
        view.setUint32(curOffset + innerOffset, getNumber(value), true)
        innerOffset += 4
        break
      case "int32":
        view.setInt32(curOffset + innerOffset, getNumber(value), true)
        innerOffset += 4
        break
      case "float32":
        view.setFloat32(curOffset + innerOffset, getNumber(value), true)
        innerOffset += 4
        break
      case "uint64":
        view.setBigUint64(curOffset + innerOffset, getBigInt(value), true)
        innerOffset += 8
        break
      case "int64":
        view.setBigInt64(curOffset + innerOffset, getBigInt(value), true)
        innerOffset += 8
        break
      case "float64":
        view.setFloat64(curOffset + innerOffset, getNumber(value), true)
        innerOffset += 8
        break
      case "string": {
        let length = field.upperBound
        if (length == undefined) {
          length = typeof value === "string" ? value.length : 0
          view.setUint32(curOffset + innerOffset, length, true)
          innerOffset += 4
        }
        if (length > 0) {
          const byteOffset = view.byteOffset + curOffset + innerOffset
          const dest = new Uint8Array(view.buffer, byteOffset, length)
          if (typeof value === "string" && value.length > 0) {
            const bytes = textEncoder.encode(value)
            dest.set(bytes.slice(0, length))
          } else {
            dest.fill(0)
          }
          innerOffset += length
        }
        break
      }
      default:
        throw new Error(`Unsupported type ${field.type}`)
    }
  }

  return innerOffset
}

function getNumber(value: unknown): number {
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "bigint") {
    return Number(value)
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0
  }
  return 0
}

function getBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value
  }
  if (typeof value === "number") {
    return BigInt(value)
  }
  if (typeof value === "boolean") {
    return value ? 1n : 0n
  }
  return 0n
}

function isArray(value: unknown): value is unknown[] | CbufTypedArray {
  return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))
}
