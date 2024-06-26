import { MessageDefinitionField } from "@foxglove/message-definition"

import { CbufMessageDefinition } from "./types"

type EnumDefinition = {
  entity: "enum"
  name: string
  isEnumClass?: boolean
  definitions: MessageDefinitionField[]
}

export function lookupMsgdef(
  nameToSchema: Map<string, CbufMessageDefinition>,
  namespaces: string[],
  typeName: string,
): CbufMessageDefinition {
  if (typeName.includes("::")) {
    // If the type name is already fully qualified, just look it up directly
    const msgdef = nameToSchema.get(typeName)
    if (msgdef) {
      return msgdef
    }
  } else {
    // Search for the message definition by fully qualified name, starting with the most specific
    // namespace and working up to the global namespace
    for (let i = namespaces.length; i >= 0; i--) {
      const fqName = namespaces.slice(0, i).concat(typeName).join("::")
      const msgdef = nameToSchema.get(fqName)
      if (msgdef) {
        return msgdef
      }
    }
  }

  let msg = `Message type ${namespaces.concat(typeName).join("::")} not found`
  if (nameToSchema.size === 0) {
    msg += " in empty schema map"
  } else if (nameToSchema.size <= 20) {
    msg += " in schema map: " + Array.from(nameToSchema.keys()).join(", ")
  } else {
    msg += ` in schema map with ${nameToSchema.size} entries`
  }
  throw new Error(msg)
}

export function lookupEnum(
  enums: Map<string, EnumDefinition>,
  namespaces: string[],
  typeName: string,
): EnumDefinition | undefined {
  if (typeName.includes("::")) {
    // If the type name is already fully qualified, just look it up directly
    const msgdef = enums.get(typeName)
    if (msgdef) {
      return msgdef
    }
  } else {
    // Search for the message definition by fully qualified name, starting with the most specific
    // namespace and working up to the global namespace
    for (let i = namespaces.length; i >= 0; i--) {
      const fqName = namespaces.slice(0, i).concat(typeName).join("::")
      const msgdef = enums.get(fqName)
      if (msgdef) {
        return msgdef
      }
    }
  }

  return undefined
}
