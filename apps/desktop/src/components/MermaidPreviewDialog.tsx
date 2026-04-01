import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@goalrate-app/ui/overlay';
import { Loader2 } from 'lucide-react';

function normalizeMermaidPreviewSvg(svgMarkup: string): string {
  if (!svgMarkup || typeof window === 'undefined' || typeof window.DOMParser === 'undefined') {
    return svgMarkup;
  }

  try {
    const parsed = new window.DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
    const svg = parsed.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== 'svg') {
      return svgMarkup;
    }

    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
      const dimensions = viewBox
        .trim()
        .split(/[,\s]+/)
        .map((value) => Number.parseFloat(value));
      if (dimensions.length === 4) {
        const viewBoxWidth = dimensions[2];
        const viewBoxHeight = dimensions[3];
        if (Number.isFinite(viewBoxWidth) && viewBoxWidth > 0) {
          svg.setAttribute('width', `${viewBoxWidth}`);
        }
        if (Number.isFinite(viewBoxHeight) && viewBoxHeight > 0) {
          svg.setAttribute('height', `${viewBoxHeight}`);
        }
      }
    }

    svg.style.maxWidth = 'none';
    svg.style.width = 'auto';

    return svg.outerHTML;
  } catch {
    return svgMarkup;
  }
}

export function MermaidPreviewDialog({
  open,
  chart,
  onOpenChange,
}: {
  open: boolean;
  chart: string;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const [svgMarkup, setSvgMarkup] = useState('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const trimmedChart = useMemo(() => chart.trim(), [chart]);

  useEffect(() => {
    if (!open || !trimmedChart) {
      setSvgMarkup('');
      setRenderError(null);
      setIsRendering(false);
      return;
    }

    let cancelled = false;

    const renderChart = async (): Promise<void> => {
      setSvgMarkup('');
      setRenderError(null);
      setIsRendering(true);

      try {
        const module = await import('mermaid');
        const mermaid = module.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
        });
        const renderId = `goal-mermaid-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(renderId, trimmedChart);

        if (!cancelled) {
          setSvgMarkup(normalizeMermaidPreviewSvg(svg));
        }
      } catch {
        if (!cancelled) {
          setRenderError('Unable to render Mermaid chart. Check syntax and try again.');
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    };

    void renderChart();

    return () => {
      cancelled = true;
    };
  }, [open, trimmedChart]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden">
        <DialogTitle className="sr-only">Mermaid preview</DialogTitle>
        <div className="h-[65vh] overflow-auto rounded-md border border-divider bg-muted/20 p-4">
          {isRendering ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Rendering flow...
            </div>
          ) : null}
          {!isRendering && renderError ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {renderError}
            </div>
          ) : null}
          {!isRendering && !renderError && svgMarkup ? (
            <div
              className="h-max w-max [&_svg]:block [&_svg]:max-w-none [&_svg]:w-auto"
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
