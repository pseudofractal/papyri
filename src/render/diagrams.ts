import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { instance } from '@viz-js/viz';
import embed from 'vega-embed';
import { expressionInterpreter } from 'vega-interpreter';
import { diagramPalette } from './diagram-theme';
import { MAX_DIAGRAM_CHARACTERS } from '../lib/limits';
let diagramIndex = 0;
let viz: ReturnType<typeof instance> | undefined;
const chartCleanup = new WeakMap<HTMLElement, () => void>();
export async function renderDiagram(
  format: string,
  code: string,
  output: HTMLElement,
  theme: string,
) {
  const palette = diagramPalette(theme);
  chartCleanup.get(output)?.();
  chartCleanup.delete(output);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    // SVG labels survive the SVG-only sanitizer; document directives cannot change this.
    htmlLabels: false,
    secure: [...(mermaid.mermaidAPI.defaultConfig.secure || []), 'htmlLabels'],
    theme: 'base',
    themeVariables: {
      darkMode: theme !== 'latte',
      background: palette.background,
      primaryColor: palette.surface,
      primaryTextColor: palette.text,
      primaryBorderColor: palette.accent,
      secondaryColor: palette.surface,
      secondaryTextColor: palette.text,
      tertiaryColor: palette.background,
      tertiaryTextColor: palette.text,
      lineColor: palette.line,
      textColor: palette.text,
      mainBkg: palette.surface,
      nodeBorder: palette.accent,
      clusterBkg: palette.background,
      clusterBorder: palette.border,
      edgeLabelBackground: palette.background,
      actorBkg: palette.surface,
      actorTextColor: palette.text,
      actorBorder: palette.accent,
      signalColor: palette.text,
      signalTextColor: palette.text,
      labelBoxBkgColor: palette.surface,
      labelBoxBorderColor: palette.border,
      labelTextColor: palette.text,
      loopTextColor: palette.text,
      noteBkgColor: palette.surface,
      noteTextColor: palette.text,
      noteBorderColor: palette.accent,
      activationBkgColor: palette.surface,
      activationBorderColor: palette.line,
      sequenceNumberColor: palette.background,
      ...Object.fromEntries(palette.colors.map((color, index) => [`pie${index + 1}`, color])),
      ...Object.fromEntries(palette.colors.map((color, index) => [`cScale${index}`, color])),
    },
    maxTextSize: MAX_DIAGRAM_CHARACTERS,
    maxEdges: 500,
    suppressErrorRendering: true,
  });

  if (code.length > MAX_DIAGRAM_CHARACTERS)
    throw new Error('Diagram exceeds the 50,000 character limit.');
  if (format === 'mermaid') {
    const result = await mermaid.render(`diagram-${diagramIndex++}`, code);
    output.innerHTML = DOMPurify.sanitize(result.svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
  } else if (format === 'dot' || format === 'graphviz') {
    const graphviz = await (viz ??= instance());
    output.innerHTML = DOMPurify.sanitize(
      graphviz.renderString(code, {
        format: 'svg',
        graphAttributes: {
          bgcolor: palette.background,
          fontcolor: palette.text,
          color: palette.border,
        },
        nodeAttributes: {
          color: palette.accent,
          fontcolor: palette.text,
          fillcolor: palette.surface,
          style: 'filled',
        },
        edgeAttributes: { color: palette.line, fontcolor: palette.text },
      }),
      {
        USE_PROFILES: { svg: true, svgFilters: true },
      },
    );
  } else if (format === 'vega' || format === 'vega-lite') {
    const spec = JSON.parse(code);
    const chart = await embed(output, spec, {
      config: {
        background: palette.background,
        view: { stroke: palette.border },
        axis: {
          labelColor: palette.text,
          titleColor: palette.text,
          gridColor: palette.surface,
          domainColor: palette.border,
          tickColor: palette.border,
        },
        legend: { labelColor: palette.text, titleColor: palette.text },
        title: { color: palette.text, subtitleColor: palette.muted },
        range: { category: palette.colors },
        mark: { color: palette.accent },
        arc: { fill: palette.accent },
        area: { fill: palette.accent },
        bar: { fill: palette.accent },
        line: { stroke: palette.accent },
        point: { fill: palette.accent },
        rect: { fill: palette.accent },
        rule: { stroke: palette.accent },
        symbol: { fill: palette.accent },
        text: { fill: palette.text },
        trail: { fill: palette.accent },
      },
      mode: format,
      renderer: 'svg',
      actions: false,
      tooltip: false,
      ast: true,
      expr: expressionInterpreter,
    });
    chartCleanup.set(output, chart.finalize);
  } else {
    throw new Error(
      'PlantUML requires Java and its own renderer. This release preserves the source; no remote diagram service is contacted. Use Mermaid or DOT for offline diagrams.',
    );
  }

  // Keep vector text readable instead of shrinking wide diagrams to the column.
  for (const svg of output.querySelectorAll<SVGSVGElement>(':scope > svg, .vega-embed > svg')) {
    const width = svg.viewBox.baseVal.width || svg.width.baseVal.value;
    if (Number.isFinite(width) && width > 0) {
      const baseFontSize = 16;
      svg.style.width = `${width / baseFontSize}rem`;
      svg.style.maxWidth = 'none';
      svg.style.height = 'auto';
    }
  }
}
