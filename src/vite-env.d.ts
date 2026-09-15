/// <reference types="vite/client" />
import React from 'react';

declare global {
  namespace React.JSX {
    interface IntrinsicElements {
      'climate-clock': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
  namespace JSX {
    interface IntrinsicElements {
      'climate-clock': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
