import { setupServiceWorkerScope } from './setup';
import type { AppBundle, LinkBundle } from './types';

/**
 * @public
 */
export const setupServiceWorker = () => {
  if (typeof self !== 'undefined' && typeof appBundles !== 'undefined') {
    setupServiceWorkerScope(self as any, appBundles, libraryBundleIds, linkBundles);
  }
};

declare const appBundles: AppBundle[];
declare const libraryBundleIds: number[];
declare const linkBundles: LinkBundle[];
