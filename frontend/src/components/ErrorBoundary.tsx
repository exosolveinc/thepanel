import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[ErrorBoundary] caught:', error, info)
  }

  handleReset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-8">
        <div className="max-w-lg w-full bg-zinc-900 border border-red-500/30 rounded-xl p-6 space-y-4">
          <h1 className="text-base font-semibold text-red-400">Something went wrong</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            The app hit an unexpected error. Your session is in memory; reload may lose it.
          </p>
          <pre className="text-[11px] text-zinc-500 bg-zinc-950/60 border border-zinc-800 rounded p-3 overflow-x-auto whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={this.handleReset}
              className="text-xs font-semibold px-4 py-2 rounded-md bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="text-xs font-semibold px-4 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
