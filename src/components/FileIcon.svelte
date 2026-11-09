<script lang="ts">
  import { fileIcon } from '../lib/file-icons';
  let {
    name,
    directory = false,
    expanded = false,
  }: { name: string; directory?: boolean; expanded?: boolean } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- only bundled, fixed SVG assets are returned -->
<span class="file-type-icon" aria-hidden="true">{@html fileIcon(name, directory, expanded)}</span>

<style>
  .file-type-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 16px;
    height: 16px;
    --vscode-ctp-text: #cdd6f4;
    --vscode-ctp-overlay1: #7f849c;
    --vscode-ctp-flamingo: #f2cdcd;
    --vscode-ctp-red: #f38ba8;
    --vscode-ctp-maroon: #eba0ac;
    --vscode-ctp-peach: #fab387;
    --vscode-ctp-yellow: #f9e2af;
    --vscode-ctp-green: #a6e3a1;
    --vscode-ctp-teal: #94e2d5;
    --vscode-ctp-sapphire: #74c7ec;
    --vscode-ctp-blue: #89b4fa;
    --vscode-ctp-mauve: #cba6f7;
  }
  :global([data-theme='latte']) .file-type-icon {
    --vscode-ctp-text: #4c4f69;
    --vscode-ctp-overlay1: #8c8fa1;
    --vscode-ctp-flamingo: #dd7878;
    --vscode-ctp-red: #d20f39;
    --vscode-ctp-maroon: #e64553;
    --vscode-ctp-peach: #fe640b;
    --vscode-ctp-yellow: #df8e1d;
    --vscode-ctp-green: #40a02b;
    --vscode-ctp-teal: #179299;
    --vscode-ctp-sapphire: #209fb5;
    --vscode-ctp-blue: #1e66f5;
    --vscode-ctp-mauve: #8839ef;
  }
  .file-type-icon :global(svg) {
    width: 16px;
    height: 16px;
    flex: none;
  }
</style>
