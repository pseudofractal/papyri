<script lang="ts">
  import { SITE_ICONS } from '../lib/site-icons';
  import type { SiteId } from '../lib/sites';

  let { site, size = 14 }: { site: SiteId; size?: number } = $props();
  const icon = $derived(SITE_ICONS[site]);
</script>

<svg
  width={size}
  height={size}
  viewBox={icon.viewBox}
  fill="currentColor"
  aria-hidden="true"
  focusable="false"><path d={icon.path} /></svg
>
