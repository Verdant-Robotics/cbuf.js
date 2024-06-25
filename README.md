# cbuf.js

> A TypeScript parser and serializer/deserializer for the Verdant Robotics cbuf Interface Definition Language (IDL)

## What is this?

[Verdant Robotics](https://www.verdantrobotics.com/) robots use an Interface Definition Language and message serialization format called "cbuf". This is similar to other IDLs such as Google Protobufs, FlatBuffers, Cap'n'Proto, DDS IDL+CDR, ROS message definitions, etc. It optimizes for matching on-wire and in-memory representations where possible, and the definition language is oriented toward C++ code generation, although dynamic parsing and non-C++ languages are also supported.

This library provides a TypeScript/JavaScript API for parsing `.cbuf` message definitions, and serializing and deserializing binary cbuf payloads.

## Usage

Here's a simple example of parsing a single schema definition with no #import statements:

```ts
import { preprocessSchema, parseSchema } from "@verdant-robotics/cbuf"

// `preprocessSchema()` is used here to strip comments
const stripped = preprocessSchema(`struct vec2 { float x; float y; } // test`)
const result = parseSchema(stripped)
console.dir(result, { depth: null })
/**
  [
    {
      name: 'vec2',
      namespaces: [],
      definitions: [ { name: 'x', type: 'float32' }, { name: 'y', type: 'float32' } ],
      hashValue: 6141859528966909963n,
      isEnum: false,
    }
  ]
*/
```

Here's a more complete parsing example that handles multiple schema definitions and #import statements:

```ts
import { preprocessSchema, parseSchema } from "@verdant-robotics/cbuf"
import { readFileSync, readdirSync } from "fs"

// Load `schemas/*.cbuf` file contents into a Map<string, string> where the
// key is the filename and the value is the file contents
const schemas = new Map<string, string>()
for (const filename of readdirSync("schemas")) {
  schemas.set(filename, readFileSync(`schemas/${filename}`, "utf-8"))
}

const schemaToParse = schemas.get("example.cbuf")!
const preprocessed = preprocessSchema(schemaToParse)
const result = parseSchema(preprocessed, schemas)
console.dir(result, { depth: null })
// ...
```

Refer to the tests for more examples of how to use the library, including serialization and deserialization.

## Development

You will need node.js >= 18.x and the `yarn` package manager installed.

1. `yarn install`
2. `yarn build`
3. `yarn test`

## License

cbuf.js is licensed under the [MIT](https://opensource.org/license/mit/).

## Releasing

1. Run `yarn version --[major|minor|patch]` to bump version
2. Run `git push && git push --tags` to push new tag
3. GitHub Actions will take care of the rest
