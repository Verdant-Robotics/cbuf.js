import { MessageDefinition } from "@foxglove/message-definition"

export type CbufMessageDefinition = MessageDefinition & {
  /** The fully qualified message name */
  name: string
  /** The namespace this definition exists in, represented as a list of strings or an empty list for
   * the global namespace. The message `a::b::c` would have namespaces `["a", "b"]. */
  namespaces: string[]
  /** The hash value of the message definition. Will be zero for enums and non-zero for structs */
  hashValue: bigint
  /** True if this is an `enum` definition */
  isEnum: boolean
  /** True if this is an `enum` definition annotated as `enum class` */
  isEnumClass: boolean
  /** True if this is a `struct` definition annotated with `@naked` */
  isNakedStruct: boolean
}

export type CbufTypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

export type CbufArray = boolean[] | number[] | bigint[] | string[] | Record<string, unknown>[]

export type CbufValue =
  | boolean
  | number
  | bigint
  | string
  | CbufTypedArray
  | CbufArray
  | { [fieldName: string]: CbufValue }

export type CbufMessageData = {
  /** The fully qualified message name */
  typeName: string
  /** A timestamp in seconds since the Unix epoch as a 64-bit float */
  timestamp: number
  /** The deserialized messge data */
  message: Record<string, CbufValue>
}

export type CbufMessage = CbufMessageData & {
  /** The size of the message header and message data, in bytes */
  size: number
  /** The message variant, for distinguishing multiple publishers of the same message type */
  variant: number
  /** The hash value of the `.cbuf` message definition */
  hashValue: bigint
}
