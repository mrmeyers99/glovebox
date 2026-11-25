// Every function must be listed in supabase/config.jsonc. A function missing from it still
// deploys, but with the gateway's JWT check on (signed-out calls get a 401 without CORS
// headers) and without the shared import map.
import { assertEquals } from '@std/assert'
import { parse } from '@std/jsonc'

const functionsDir = new URL('../', import.meta.url)
const config = parse(
  await Deno.readTextFile(new URL('../config.jsonc', functionsDir)),
) as { functions?: Record<string, unknown> }

const functionNames: string[] = []
for await (const entry of Deno.readDir(functionsDir)) {
  if (entry.isDirectory && !entry.name.startsWith('_')) {
    functionNames.push(entry.name)
  }
}

Deno.test('finds the functions', () => {
  assertEquals(functionNames.includes('health'), true)
})

for (const name of functionNames) {
  Deno.test(`${name} is configured in supabase/config.jsonc`, () => {
    assertEquals(config.functions?.[name], {
      verify_jwt: false,
      import_map: './functions/deno.json',
    })
  })
}
