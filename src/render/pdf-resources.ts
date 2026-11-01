const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const RESOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
let manifest: Promise<Set<string>> | undefined;
const resources = new Map<string, Promise<Uint8Array>>();

function assetUrl(path: string): URL {
  return new URL(import.meta.env.BASE_URL + path, location.href);
}

function resourceManifest(): Promise<Set<string>> {
  return (manifest ??= fetch(assetUrl('pdf-resources.json'))
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load PDF resource manifest: ${response.status}`);
      const names: unknown = await response.json();
      if (
        !Array.isArray(names) ||
        !names.every((name) => typeof name === 'string' && RESOURCE_NAME.test(name))
      )
        throw new Error('The bundled PDF resource manifest is invalid.');
      return new Set<string>(names);
    })
    .catch((error) => {
      manifest = undefined;
      throw error;
    }));
}

/** Read only named resources included in the bundled PDF.js manifest. */
export async function loadPdfResource(name: string): Promise<Uint8Array> {
  if (!RESOURCE_NAME.test(name) || !(await resourceManifest()).has(name))
    throw new Error('The requested PDF resource is not bundled.');
  let resource = resources.get(name);
  if (!resource) {
    resource = fetch(assetUrl(`pdf-resources/${encodeURIComponent(name)}`))
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load PDF resource: ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > MAX_RESOURCE_BYTES)
          throw new Error('The bundled PDF resource is too large.');
        return bytes;
      })
      .catch((error) => {
        resources.delete(name);
        throw error;
      });
    resources.set(name, resource);
  }
  return resource;
}
