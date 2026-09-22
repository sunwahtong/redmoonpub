import React from 'react';
import {useLiveData} from '../../hooks/useLiveData';

/**
 * Fixed open/closed indicator, driven by `/api/public/status` — which reports
 * whether any staff shift is currently open. Legacy `.rm-status-pill`.
 */
export const StatusPill: React.FC = () => {
  const {data, error} = useLiveData<{open: boolean}>('/api/public/status', {intervalMs: 30000});

  // Say nothing rather than guess while the first request is in flight.
  if (error || !data) return null;

  return (
    <div className={`rm-status-pill ${data.open ? 'is-open' : 'is-closed'}`} role="status">
      <i aria-hidden="true"/>
      <span>{data.open ? 'A RED MOON MOST NYITVA' : 'A RED MOON MOST ZÁRVA'}</span>
    </div>
  );
};
