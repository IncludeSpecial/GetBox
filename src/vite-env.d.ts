/// <reference types="vite/client" />

import type { GetBoxAPI } from '../electron/preload';

declare global {
  interface Window {
    getbox: GetBoxAPI;
  }
}

export {};
