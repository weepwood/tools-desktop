import { Component, type ErrorInfo, type ReactNode } from "react";

/*
 * Last line of defence. A render error in one screen must not leave the user
 * with a blank window: the shell stays, the message explains what happened,
 * and the reload button re-mounts the renderer.
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the detail in the console for support; the UI stays non-technical.
    console.error("HALO 界面渲染失败", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="halo-crash">
        <div className="halo-crash-mark" aria-hidden="true" />
        <h1>界面出现了未处理的错误</h1>
        <p>
          已有文件和任务记录不受影响。你可以重新载入界面继续；若问题重复出现，
          请把下面的信息反馈给维护者。
        </p>
        <pre>{this.state.error.message}</pre>
        <button className="halo-button primary" onClick={() => window.location.reload()}>
          重新载入界面
        </button>
      </div>
    );
  }
}
