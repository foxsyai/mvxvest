import './styles/tailwind.css';
import './styles/style.css';

import { environment, walletConnectV2ProjectId } from 'config';
import { InitAppType } from './lib';

// No "In Memory Provider" (it asks for a private key in the browser), no native
// auth (there is no backend to prove an address to). sdk-dapp's own panels take
// the theme public/theme.js set before the page painted.

const startTheme =
  document.documentElement.getAttribute('data-mvx-theme') === 'mvx:dark-theme'
    ? 'mvx:dark-theme'
    : 'mvx:light-theme';

export const config: InitAppType = {
  storage: { getStorageCallback: () => sessionStorage },
  dAppConfig: {
    nativeAuth: false,
    environment,
    theme: startTheme,
    providers: {
      walletConnect: {
        walletConnectV2ProjectId
      }
    }
  }
};
