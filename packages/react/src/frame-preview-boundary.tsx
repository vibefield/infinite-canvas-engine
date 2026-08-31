import {
  Component,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from "react";

export interface FramePreviewBoundaryProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  readonly onError?: (error: unknown, info: ErrorInfo) => void;
}

/** Isolates one author-owned instance preview from the rest of the canvas. */
export class FramePreviewBoundary extends Component<
  FramePreviewBoundaryProps,
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactElement | ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
