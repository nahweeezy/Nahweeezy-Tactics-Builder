import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
    this.setState({ info });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-5 text-sm overflow-auto"
             style={{ maxHeight: 'calc(100vh - 200px)' }}>
          <div className="font-extrabold text-rose-300 mb-2 tracking-[0.2em]"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            ⚠ RENDER ERROR
          </div>
          <pre className="whitespace-pre-wrap text-rose-200 text-[12px]">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          {this.state.info?.componentStack && (
            <pre className="whitespace-pre-wrap text-rose-300/70 text-[10px] mt-3">
              {this.state.info.componentStack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
