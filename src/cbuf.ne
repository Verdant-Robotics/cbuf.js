main -> _ NamespaceOrEntityList _ {% (d) => d[1] %}

# Namespaces

NamespaceOrEntityList -> NamespaceOrEntity {% (d) => [d[0]] %}
  | NamespaceOrEntityList _ NamespaceOrEntity {% (d) => d[0].concat(d[2]) %}

NamespaceOrEntity -> Namespace {% id %}
  | Entity {% id %}

Namespace -> "namespace" __ IDENTIFIER _ "{" _ NamespaceOrEntityList _ "}"
  {% (d) => ({ entity: "namespace", name: d[2], definitions: d[6] }) %}

# Non-namespace entities (constants, enums, structs)

EntityList -> Entity {% (d) => [d[0]] %}
  | EntityList _ Entity {% (d) => d[0].concat(d[2]) %}

Entity -> Constant {% id %}
  | Enum {% id %}
  | Struct {% id %}

Constant -> "const" __ TypeName __ IDENTIFIER _ "=" _ AssignmentRHS ";"
  {% (d) => ({ entity: "constant", ...d[2], name: d[4], value: d[8] }) %}

Enum -> "enum" EnumClass __ IDENTIFIER _ "{" _ EnumList _ "}"
  {% (d) => ({ entity: "enum", name: d[3], isEnumClass: d[1], definitions: d[7] }) %}

EnumClass -> null {% (d) => undefined %}
  | _ "class" {% (d) => true %}

EnumList -> _EnumList ",":? {% id %}

_EnumList -> EnumValue {% (d) => [d[0]] %}
  | _EnumList _ "," _ EnumValue {% (d) => d[0].concat(d[4]) %}

EnumValue -> IDENTIFIER EnumAssignment
  {% (d) => ({ type: "uint32", name: d[0], isConstant: true, value: d[1] }) %}

EnumAssignment -> null {% (d) => undefined %}
  | _ "=" _ Number {% (d) => d[3] %}

Struct -> "struct" __ IDENTIFIER _ Naked "{" _ FieldList _ "}"
  {% (d) => ({ entity: "struct", name: d[2], isNakedStruct: d[4], definitions: d[7] }) %}

Naked -> null {% (d) => undefined %}
  | "@naked" _ {% (d) => true %}

# Fields

FieldList -> Field {% (d) => [d[0]] %}
  | FieldList _ Field {% (d) => d[0].concat(d[2]) %}

Field -> TypeName __ IDENTIFIER Array _ Assignment _ ";"
  {% (d) => ({ name: d[2], ...d[0], ...d[3], ...d[5] }) %}

Array -> null {% (d) => ({}) %}
  | "[" _ "]" {% (d) => ({ isArray: true }) %}
  | "[" _ NumericExpression _ "]" {% (d) => ({ isArray: true, arrayLength: d[2] }) %}
  | "[" _ NumericExpression _ "]" _ "@compact" {% (d) => ({ isArray: true, arrayUpperBound: d[2] }) %}

Assignment -> null {% (d) => ({}) %}
  | "=" _ AssignmentRHS {% (d) => ({ defaultValue: d[2] }) %}

AssignmentRHS -> Boolean {% id %}
  | NumericExpression {% id %}
  | String {% id %}
  | EmptyArray {% id %}
  | BooleanArray {% id %}
  | NumericArray {% id %}
  | StringArray {% id %}
  | IDENTIFIER {% id %}

# Expressions

NumericExpression -> AS {% id %}

# Parentheses
P -> "(" _ AS _ ")" {% function(d) {return d[2]; } %}
  | Number       {% id %}

# Multiplication and division
MD -> MD _ "*" _ P  {% function(d) {return d[0]*d[4]; } %}
  | MD _ "/" _ P  {% function(d) {return d[0]/d[4]; } %}
  | P             {% id %}

# Addition and subtraction
AS -> AS _ "+" _ MD {% function(d) {return d[0]+d[4]; } %}
  | AS _ "-" _ MD {% function(d) {return d[0]-d[4]; } %}
  | MD            {% id %}

# Literals and types

Boolean -> "true" {% (d) => true %}
  | "false" {% (d) => false %}

Number -> "-":? [0-9]:+ "." [0-9]:+ {% (d) => parseFloat((d[0] || "") + d[1].join("") + "." + d[3].join("")) %}
  | "-":? "." [0-9]:+ {% (d) => parseFloat((d[0] || "") + "." + d[2].join("")) %}
  | "-":? [0-9]:+ "." {% (d) => parseFloat((d[0] || "") + d[1].join("") + ".0") %}
  | "-":? [0-9]:+ {% (d) => parseFloat((d[0] || "") + d[1].join("")) %}

String -> "\"" [^\"]:* "\"" {% (d) => d[1].join("") %}

EmptyArray -> "{" _ "}" {% (d) => [] %}

BooleanArray -> "{" _ BooleanList _ "}" {% (d) => d[2] %}

NumericArray -> "{" _ NumericList _ "}" {% (d) => d[2] %}

StringArray -> "{" _ StringList _ "}" {% (d) => d[2] %}

BooleanList -> Boolean {% (d) => [d[0]] %}
  | Boolean _ "," _ BooleanList {% (d) => [d[0]].concat(d[4]) %}

NumericList -> Number {% (d) => [d[0]] %}
  | Number _ "," _ NumericList {% (d) => [d[0]].concat(d[4]) %}

StringList -> String {% (d) => [d[0]] %}
  | String _ "," _ StringList {% (d) => [d[0]].concat(d[4]) %}

TypeName -> BasicType {% id %}
  | ComplexType {% id %}

BasicType ->
    "string" {% (d) => ({ type: "string" }) %}
  | "short_string" {% (d) => ({ type: "short_string" }) %}
  | "bool" {% (d) => ({ type: "bool" }) %}
  | "int" {% (d) => ({ type: "int32" }) %}
  | "float" {% (d) => ({ type: "float32" }) %}
  | "double" {% (d) => ({ type: "float64" }) %}
  | "s8" {% (d) => ({ type: "int8" }) %}
  | "s16" {% (d) => ({ type: "int16" }) %}
  | "s32" {% (d) => ({ type: "int32" }) %}
  | "s64" {% (d) => ({ type: "int64" }) %}
  | "u8" {% (d) => ({ type: "uint8" }) %}
  | "u16" {% (d) => ({ type: "uint16" }) %}
  | "u32" {% (d) => ({ type: "uint32" }) %}
  | "u64" {% (d) => ({ type: "uint64" }) %}
  | "f32" {% (d) => ({ type: "float32" }) %}
  | "f64" {% (d) => ({ type: "float64" }) %}
  | "int8" {% (d) => ({ type: "int8" }) %}
  | "int16" {% (d) => ({ type: "int16" }) %}
  | "int32" {% (d) => ({ type: "int32" }) %}
  | "int64" {% (d) => ({ type: "int64" }) %}
  | "uint8" {% (d) => ({ type: "uint8" }) %}
  | "uint16" {% (d) => ({ type: "uint16" }) %}
  | "uint32" {% (d) => ({ type: "uint32" }) %}
  | "uint64" {% (d) => ({ type: "uint64" }) %}
  | "float32" {% (d) => ({ type: "float32" }) %}
  | "float64" {% (d) => ({ type: "float64" }) %}
  | "int8_t" {% (d) => ({ type: "int8" }) %}
  | "int16_t" {% (d) => ({ type: "int16" }) %}
  | "int32_t" {% (d) => ({ type: "int32" }) %}
  | "int64_t" {% (d) => ({ type: "int64" }) %}
  | "uint8_t" {% (d) => ({ type: "uint8" }) %}
  | "uint16_t" {% (d) => ({ type: "uint16" }) %}
  | "uint32_t" {% (d) => ({ type: "uint32" }) %}
  | "uint64_t" {% (d) => ({ type: "uint64" }) %}

ComplexType -> IDENTIFIER ("::" IDENTIFIER):*
  {% (d) => ({ type: [d[0]].concat(d[1].map(d => d[1])).join("::"), isComplex: true }) %}

IDENTIFIER -> [a-zA-Z_] [a-zA-Z0-9_]:* {% (d, _, reject) => {
  const KEYWORDS = [
    "namespace", "const", "enum", "struct", "class", "true", "false",
    "string", "short_string", "bool", "int", "float", "double",
    "s8", "s16", "s32", "s64", "u8", "u16", "u32", "u64", "f32", "f64",
    "int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64", "float32", "float64",
    "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t"
  ];
  const name = d[0] + d[1].join("");
  return KEYWORDS.includes(name) ? reject : name;
} %}

# Whitespace: `_` is optional, `__` is required
_  -> wschar:* {% (d) => undefined %}
__ -> wschar:+ {% (d) => undefined %}

wschar -> [ \t\n\v\f] {% id %}
