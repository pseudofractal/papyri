import { invokeHost } from './native';

export interface DownloadableReference {
  key: string;
  kind: string;
  identifier: string;
  pmc?: string | null;
}

export interface SavedResource {
  path: string;
  format: string;
  source_url: string;
}

export interface ResourceFailure {
  identifier: string;
  error: string;
}

export interface DownloadedResources {
  directory: string;
  files: SavedResource[];
  failures: ResourceFailure[];
}

/** Download PDFs or landing-page HTML into <cwd>/references. */
export async function downloadReferences(
  references: DownloadableReference[],
): Promise<DownloadedResources> {
  if (!references.length) throw new Error('No references to download.');
  return invokeHost<DownloadedResources>('download_bibliography_resources', {
    resources: references.map((reference) => ({
      filename: reference.key || 'reference',
      kind: reference.kind,
      identifier: reference.identifier,
      pmc: reference.pmc ?? null,
    })),
  });
}
