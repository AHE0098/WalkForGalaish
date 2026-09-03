import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home.js';
import { Room } from './pages/Room.js';
import { ViewProvider } from './views/ViewHost.js';
import { AssetProvider } from './assets.js';

class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err)
      return (
        <main className="wrap">
          <h1>Something broke</h1>
          <p className="err">{this.state.err.message}</p>
          <a href="/">Return home</a>
        </main>
      );
    return this.props.children;
  }
}

export function App() {
  return (
    <Boundary>
      <BrowserRouter>
        <AssetProvider>
        <ViewProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:code" element={<Room />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ViewProvider>
        </AssetProvider>
      </BrowserRouter>
    </Boundary>
  );
}
