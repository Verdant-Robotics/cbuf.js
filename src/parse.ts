import { ConstantValue, DefaultValue, MessageDefinitionField } from "@foxglove/message-definition"
import { Grammar, Parser } from "nearley"

import cbufRules from "./cbuf.ne"
import { lookupEnum, lookupMsgdef } from "./lookup"
import { CbufMessageDefinition } from "./types"

const CBUF_GRAMMAR = Grammar.fromCompiled(cbufRules)

type NamespaceDefinition = {
  entity: "namespace"
  name: string
  definitions: ParserEntityDefinition[]
}

type ConstantDefinition = {
  entity: "constant"
  type: string
  name: string
  value: ConstantValue
}

type EnumDefinition = {
  entity: "enum"
  name: string
  isEnumClass?: boolean
  definitions: MessageDefinitionField[]
}

type StructDefinition = {
  entity: "struct"
  name: string
  isNakedStruct?: boolean
  definitions: MessageDefinitionField[]
}

type ParserEntityDefinition =
  | NamespaceDefinition
  | ConstantDefinition
  | EnumDefinition
  | StructDefinition

/**
 * Strip comments, then resolve any #import statements in the message
 * definition, recursively, and return the resolved message definition.
 * @param messageDefinition The raw string message definition
 * @param importedDefinitions A map from import paths to their content
 * @returns The resolved message definition
 */
export function preprocess(
  messageDefinition: string,
  importedDefinitions = new Map<string, string>(),
): string {
  return preprocessRecursive(messageDefinition, importedDefinitions, new Set())
}

export function computeHashValue(
  nameToSchema: Map<string, CbufMessageDefinition>,
  namespaces: string[],
  typeName: string,
): bigint {
  const msgdef = lookupMsgdef(nameToSchema, namespaces, typeName)

  // Build a hash-format string representation of the message definition
  const buf: string[] = []
  buf.push(`struct ${typeName} \n`)
  for (const field of msgdef.definitions) {
    if (field.isArray === true) {
      buf.push(`[${field.arrayLength ?? 0}] `)
    }

    if (field.isComplex === true) {
      const nestedHash = computeHashValue(nameToSchema, msgdef.namespaces, field.type)
      buf.push(`${nestedHash} ${field.name};\n`)
    } else {
      buf.push(`${elementTypeToStrC(field.type)} ${field.name}; \n`) // The space is intentional
    }
  }

  // Compute the hash value
  return hashString(buf.join(""))
}

function preprocessRecursive(
  messageDefinition: string,
  importedDefinitions: Map<string, string>,
  imported: Set<string>,
): string {
  // Remove `//` comments and `/* */` comments
  let cleanedMessageDefinition = messageDefinition
    .replace(/\/\/.*$/gm, "") // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments

  // Find all #import statements
  const importStatements = cleanedMessageDefinition.match(/#import\s+"(.+)"/g)
  if (!importStatements) {
    return cleanedMessageDefinition
  }

  // Recursively resolve imports
  for (const importStatement of importStatements) {
    // Extract the import path and check if it exists
    const importPath = importStatement.match(/#import\s+"(.+)"/)![1]!
    if (!importedDefinitions.has(importPath)) {
      throw new Error(`Import not found: ${importPath}`)
    }
    const importContent = importedDefinitions.get(importPath)
    if (!importContent) {
      throw new Error(`Import not found: ${importPath}`)
    }

    // Check if this is a previously unseen import
    let preprocessedImportContent = ""
    if (!imported.has(importPath)) {
      imported.add(importPath)

      // Recursively preprocess the imported content
      preprocessedImportContent = preprocessRecursive(importContent, importedDefinitions, imported)

      // Replace the import statement with the preprocessed content
      cleanedMessageDefinition = cleanedMessageDefinition.replace(
        importStatement,
        preprocessedImportContent,
      )
    } else {
      // Simply remove the import statement
      cleanedMessageDefinition = cleanedMessageDefinition.replace(importStatement, "")
    }
  }

  return cleanedMessageDefinition
}

/**
 * Parses a preprocessed message definition and returns the parsed schema as an
 * array of cbuf message definitions.
 * @param messageDefinition The raw string message definition after `preprocess()`
 * @returns The parsed schema as an array of cbuf message definitions
 */
export function parse(messageDefinition: string): CbufMessageDefinition[] {
  const parser = new Parser(CBUF_GRAMMAR)
  parser.feed(messageDefinition)
  const parseResults = parser.finish()
  if (parseResults.length > 1) {
    throw new Error(`Ambiguous parse: ${parseResults.length} results`)
  }
  if (parseResults.length === 0) {
    throw new Error("No parse results")
  }

  const entities = parseResults[0] as ParserEntityDefinition[]
  if (entities.length === 0) {
    throw new Error("No entities found")
  }

  const entityNames = new Set<string>()
  const namespaces: string[] = []
  const constants = new Map<string, ConstantDefinition>()
  const enums = new Map<string, EnumDefinition>()

  const parsed = parseEntities(entities, entityNames, namespaces, constants, enums)
  let structCount = 0

  // Build a map from struct/enum name to definition
  const map = new Map<string, CbufMessageDefinition>()
  for (const result of parsed) {
    map.set(result.name, result)
    if (!result.isEnum) {
      structCount++
    }
  }

  if (structCount === 0) {
    throw new Error("No struct definitions found")
  }

  // Compute hash values
  for (const result of parsed) {
    if (!result.isEnum) {
      result.hashValue = computeHashValue(map, result.namespaces, result.name)
    }
  }

  return parsed
}

function parseEntities(
  entities: ParserEntityDefinition[],
  entityNames: Set<string>,
  namespaces: string[],
  constants: Map<string, ConstantDefinition>,
  enums: Map<string, EnumDefinition>,
): CbufMessageDefinition[] {
  const results: CbufMessageDefinition[] = []

  for (const entity of entities) {
    const entityName = namespaces.concat(entity.name).join("::")

    // Check for duplicate entity names
    if (entityName && entity.entity !== "namespace") {
      if (entityNames.has(entityName)) {
        throw new Error(`Duplicate entity name: ${entityName}`)
      }
      entityNames.add(entityName)
    }

    switch (entity.entity) {
      case "namespace": {
        // Nested namespaces work fine, but the reference implementation doesn't support them so we
        // throw an error here to match the reference implementation
        if (namespaces.length > 0) {
          throw new Error("Nested namespaces are not allowed")
        }

        results.push(
          ...parseEntities(
            entity.definitions,
            entityNames,
            namespaces.concat(entity.name),
            constants,
            enums,
          ),
        )
        break
      }
      case "constant": {
        // Type check constant values
        defaultValueTypeCheck(entity.name, entity.type, entity.value)

        constants.set(entityName, entity)
        break
      }
      case "enum": {
        enums.set(entityName, entity)
        // Enums produce definitions, where each value is a "field" with `isConstant: true` so the
        // it appears like a struct with zero size
        const definitions = entity.definitions.slice()

        // Ensure a value is set for each enum field
        let nextValue = 0
        for (const definition of definitions) {
          if (definition.value == undefined) {
            definition.value = nextValue++
          } else {
            if (typeof definition.value !== "number") {
              throw new Error(
                `Invalid enum value "${definition.value}" for entry "${definition.name}" of enum "${entityName}", expected a number`,
              )
            }
            nextValue = definition.value + 1
          }
        }

        results.push({
          name: entityName,
          namespaces,
          definitions,
          hashValue: BigInt(0),
          isEnum: true,
          isEnumClass: entity.isEnumClass ?? false,
          isNakedStruct: false,
        })
        break
      }
      case "struct": {
        const definitions = entity.definitions.slice()

        // Rewrite enum-typed fields as uint32s
        for (const definition of definitions) {
          if (definition.isComplex === true) {
            // Check if this type resolves to an enum
            const enumDefinition = lookupEnum(enums, namespaces, definition.type)
            if (enumDefinition) {
              // Rewrite the field as a uint32
              definition.type = "uint32"
              definition.isComplex = undefined

              if (
                definition.defaultValue != undefined &&
                typeof definition.defaultValue !== "number"
              ) {
                // Rewrite the default value as a number
                const enumValue = enumDefinition.definitions.find(
                  (d) => d.name === definition.defaultValue,
                )
                if (enumValue) {
                  definition.defaultValue = enumValue.value
                } else {
                  throw new Error(
                    `Unknown enum value "${definition.defaultValue}" for enum "${definition.type}"`,
                  )
                }
              }
            } else if (!definition.type.includes("::")) {
              definition.type = namespaces.concat(definition.type).join("::")
            }
          }
        }

        // Type check default values
        for (const definition of definitions) {
          if (definition.defaultValue != undefined) {
            if (definition.isComplex === true) {
              throw new Error(
                `Complex types cannot have default values (${definition.type} ${definition.name})`,
              )
            } else if (definition.isArray === true) {
              if (!Array.isArray(definition.defaultValue)) {
                throw new Error(
                  `Invalid default value "${definition.defaultValue}" for array field (${definition.name})`,
                )
              }

              // Type check array elements
              for (const element of definition.defaultValue) {
                defaultValueTypeCheck(definition.name, definition.type, element)
              }
            } else {
              defaultValueTypeCheck(definition.name, definition.type, definition.defaultValue)
            }
          }
        }

        results.push({
          name: entityName,
          namespaces,
          definitions,
          hashValue: BigInt(0),
          isEnum: false,
          isEnumClass: false,
          isNakedStruct: entity.isNakedStruct ?? false,
        })
        break
      }
    }
  }

  return results
}

function defaultValueTypeCheck(fieldName: string, typeName: string, element: DefaultValue) {
  switch (typeName) {
    case "string":
    case "short_string":
      if (typeof element !== "string") {
        throw new Error(`Invalid default value "${element}" for string field (${fieldName})`)
      }
      break
    case "bool":
      if (typeof element !== "boolean") {
        throw new Error(`Invalid default value "${element}" for bool field (${fieldName})`)
      }
      break
    default:
      if (typeof element !== "number") {
        throw new Error(`Invalid default value "${element}" for ${typeName} field (${fieldName})`)
      }
      break
  }
}

function hashString(str: string): bigint {
  let hash = 5381n
  const mask = 0xffffffffffffffffn // 64-bit mask for overflow

  for (const c of str) {
    // Simulate 64-bit overflow like C behavior
    hash = (((hash << 5n) + hash) & mask) + BigInt(c.charCodeAt(0))
    hash &= mask // Apply mask again in case of overflow
  }
  return hash
}

function elementTypeToStrC(type: string): string {
  switch (type) {
    case "uint8":
      return "uint8_t"
    case "uint16":
      return "uint16_t"
    case "uint32":
      return "uint32_t"
    case "uint64":
      return "uint64_t"
    case "int8":
      return "int8_t"
    case "int16":
      return "int16_t"
    case "int32":
      return "int32_t"
    case "int64":
      return "int64_t"
    case "float32":
      return "float"
    case "float64":
      return "double"
    case "string":
      return "std::string"
    case "short_string":
      return "VString<15>"
    case "bool":
      return "bool"
    default:
      throw new Error(`Unsupported type ${type}`)
  }
}
