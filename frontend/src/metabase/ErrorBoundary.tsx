import type {
  ComponentType,
  ErrorInfo,
  ForwardedRef,
  PropsWithChildren,
} from "react";
import { Component, forwardRef } from "react";

import { useReportFrontendErrorMutation } from "metabase/api";
import { SmallGenericError } from "metabase/common/components/ErrorPages";

/**
 * Props the boundary may pass to a custom fallback. Fallbacks are free to
 * ignore them, which is why they are all optional: every existing caller
 * passes a zero-prop component.
 */
interface ErrorFallbackProps {
  message?: string;
  "data-testid"?: string;
  ref?: ForwardedRef<HTMLDivElement>;
}

interface ErrorBoundaryProps extends PropsWithChildren {
  onError?: (errorInfo: ErrorInfo) => void;
  errorComponent?: ComponentType;
  message?: string;
}

interface ErrorBoundaryInnerProps extends ErrorBoundaryProps {
  forwardedRef?: ForwardedRef<HTMLDivElement>;
  onReportError: (error: Error) => void;
}

interface ErrorBoundaryInnerState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundaryInner extends Component<
  ErrorBoundaryInnerProps,
  ErrorBoundaryInnerState
> {
  constructor(props: any) {
    super(props);
    this.state = {
      hasError: false,
    };
  }

  static getDerivedStateFromError(error: Error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
    this.props.onReportError(error);
    // if we don't provide a specific onError action, the component will display a generic error message
    if (this.props.onError) {
      this.props.onError(errorInfo);
      this.setState({
        hasError: false,
      });
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.errorComponent) {
        // Callers register zero-prop fallbacks, but the boundary always passes
        // a ref, message and test id. Narrowing here keeps those call sites
        // valid without widening the public `errorComponent` prop type.
        const ErrorComponent = this.props
          .errorComponent as ComponentType<ErrorFallbackProps>;
        return (
          <ErrorComponent
            ref={this.props.forwardedRef}
            message={this.props.message}
            data-testid="error-boundary"
          />
        );
      }
      return (
        <div
          ref={this.props.forwardedRef}
          role="alert"
          style={{
            padding: "20px",
            margin: "16px 0",
            backgroundColor: "rgba(248, 250, 252, 0.95)",
            border: "1px solid #CBD5E1",
            borderRadius: "8px",
            color: "#1E293B",
            fontFamily: "inherit",
          }}
          data-testid="error-boundary"
        >
          <div
            style={{
              fontSize: "15px",
              fontWeight: 600,
              marginBottom: "6px",
              color: "#0F172A",
            }}
          >
            {this.props.message ||
              "Something went wrong while rendering this view."}
          </div>
          <div
            style={{
              fontSize: "13px",
              color: "#475569",
              marginBottom: "12px",
            }}
          >
            Try refreshing the view. If the issue persists, contact your
            administrator with the time this occurred.
          </div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: undefined })}
            style={{
              padding: "6px 12px",
              fontSize: "13px",
              fontWeight: 600,
              color: "#FFFFFF",
              backgroundColor: "#2563EB",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// eslint-disable-next-line import/no-default-export -- deprecated usage
export default forwardRef<HTMLDivElement, ErrorBoundaryProps>(
  function ErrorBoundary(props, ref) {
    const [reportFrontendError] = useReportFrontendErrorMutation();
    return (
      <ErrorBoundaryInner
        {...props}
        forwardedRef={ref}
        onReportError={(err) =>
          void reportFrontendError({
            type: "component-crash",
            message: err?.message,
            stack: err?.stack,
          })
        }
      />
    );
  },
);
