import React from 'react';

interface State {
  error: Error | null;
}

/**
 * Catches a render error anywhere below it and shows a page in the house
 * style instead of a blank screen. The error goes to the console; the
 * visitor gets a way back.
 */
export class ErrorBoundary extends React.Component<{children: React.ReactNode}, State> {
  state: State = {error: null};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[red-moon] render failed', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-[80vh] items-center justify-center px-[var(--rm-gutter)] pt-[68px] text-center">
        <div className="max-w-md">
          <div className="rm-label">RED MOON / HIBA</div>
          <h1 className="rm-heading mt-4 font-heading text-[34px] leading-tight text-white">
            Valami <em>elakadt.</em>
          </h1>
          <p className="mt-4 text-[12px] leading-[1.8] text-[#9e9795]">
            Ez az oldal nem tudott megjelenni. Az adataid megvannak; próbáld frissíteni, vagy menj vissza a főoldalra.
          </p>
          <p className="mt-3 break-words text-[9px] tracking-[0.1em] text-[#5f5959]">{this.state.error.message}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            <button type="button" onClick={() => window.location.reload()} className="rm-btn is-red">
              FRISSÍTÉS
            </button>
            <a href="/" className="rm-btn">
              FŐOLDAL ↗
            </a>
          </div>
        </div>
      </main>
    );
  }
}
