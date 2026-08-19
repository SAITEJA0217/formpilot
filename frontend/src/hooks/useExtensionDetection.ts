"use client";

import { useEffect, useState } from 'react';
import { FORM_PILOT_EXTENSION_ID } from '@/lib/extension-config';

export function useExtensionDetection() {
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);

  useEffect(() => {
    // If extension ID is placeholder or window.chrome is unavailable, mark as not detected
    if (
      !FORM_PILOT_EXTENSION_ID || 
      FORM_PILOT_EXTENSION_ID === "PLACEHOLDER_EXTENSION_ID" || 
      typeof window === 'undefined' || 
      typeof (window as any).chrome === 'undefined' || 
      typeof (window as any).chrome.runtime === 'undefined' ||
      typeof (window as any).chrome.runtime.sendMessage === 'undefined'
    ) {
      setIsInstalled(false);
      setIsChecking(false);
      return;
    }

    try {
      (window as any).chrome.runtime.sendMessage(
        FORM_PILOT_EXTENSION_ID,
        { type: 'PING' },
        (response: any) => {
          if ((window as any).chrome.runtime.lastError) {
            setIsInstalled(false);
          } else if (response && response.installed) {
            setIsInstalled(true);
          } else {
            setIsInstalled(false);
          }
          setIsChecking(false);
        }
      );
    } catch (e) {
      setIsInstalled(false);
      setIsChecking(false);
    }
  }, []);

  return { isInstalled, isChecking };
}
