// dashboard/src/components/ember-chat/useAlwaysOn.ts
//
// Stub for Always-On Listening. Tracks UI state (muted / listening /
// listening-stale / processing) and consent dialog visibility.
// The full VAD + audio capture loop from the legacy always-on.js (393 lines)
// is NOT ported yet — that's a follow-up. This hook gives EmberChatPage
// enough surface to render the AlwaysOnIndicator correctly.

import { useCallback, useEffect, useState } from 'react';

import type { AlwaysOnState } from './ServerStatusBar';

const CONSENT_KEY = 'ember.alwaysOn.consented';

export interface UseAlwaysOnReturn {
  state: AlwaysOnState;
  consentRequired: boolean;
  toggle: () => void;
  acceptConsent: () => void;
  declineConsent: () => void;
}

export function useAlwaysOn(): UseAlwaysOnReturn {
  const [enabled, setEnabled] = useState(false);
  const [consentRequired, setConsentRequired] = useState(false);
  const [processing] = useState(false);
  const [stale, setStale] = useState(false);

  // Consent persistence
  useEffect(() => {
    if (!enabled) return;
    const consented = typeof localStorage !== 'undefined'
      && localStorage.getItem(CONSENT_KEY) === 'true';
    if (!consented) setConsentRequired(true);
  }, [enabled]);

  // Stale detection: after 30min of listening without activity, fade dot.
  useEffect(() => {
    if (!enabled) {
      setStale(false);
      return;
    }
    const timer = setTimeout(() => setStale(true), 30 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled((v) => !v);
  }, []);

  const acceptConsent = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONSENT_KEY, 'true');
    }
    setConsentRequired(false);
  }, []);

  const declineConsent = useCallback(() => {
    setConsentRequired(false);
    setEnabled(false);
  }, []);

  let state: AlwaysOnState = 'muted';
  if (enabled) {
    if (processing) state = 'processing';
    else if (stale) state = 'listening-stale';
    else state = 'listening';
  }

  return { state, consentRequired, toggle, acceptConsent, declineConsent };
}
